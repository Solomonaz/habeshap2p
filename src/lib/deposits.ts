import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { getServerEnv } from "@/lib/env";
import { getChainProvider } from "@/lib/chain";
import { getSweepStrategy, getPooledDepositAddress } from "@/lib/settings";

/**
 * Deposit side of the on-chain ramp (Phase 7).
 *
 * Two responsibilities:
 *   1. Hand each user a stable deposit address (derived by the chain provider,
 *      recorded once via wallet_set_deposit_address).
 *   2. A poller (cron) that reads confirmed inbound transfers from the provider
 *      and credits the internal ledger, idempotently on tx hash.
 *
 * Everything here uses the service-role client and must only run server-side.
 */

/**
 * Return the signed-in user's deposit address, deriving + persisting one on
 * first use. Reads the wallet AS THE USER (RLS) to find an existing address, but
 * the write goes through the service-role RPC since clients can't mutate wallets.
 */
export async function ensureDepositAddress(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const { data: wallet, error } = await supabase
    .from("wallets")
    .select("deposit_address")
    .eq("user_id", userId)
    .single();
  if (error) throw new Error(`failed to load wallet: ${error.message}`);
  if (wallet?.deposit_address) return wallet.deposit_address;

  const provider = await getChainProvider();
  const address = await provider.deriveDepositAddress(userId);
  const admin = createAdminSupabase();
  const { data, error: rpcErr } = await admin.rpc("wallet_set_deposit_address", {
    p_user: userId,
    p_address: address,
  });
  if (rpcErr) throw new Error(rpcErr.message);
  // The RPC returns the persisted address (the existing one if a race set it).
  return data ?? address;
}

/**
 * Resolve the shared pooled/omnibus deposit address: the admin override if set,
 * otherwise the configured hot-wallet address. Throws if neither is available
 * (pooled mode can't function without a destination).
 */
async function resolvePooledAddress(): Promise<string> {
  const override = await getPooledDepositAddress();
  if (override) return override;
  const { TRON_HOT_WALLET_ADDRESS } = getServerEnv();
  if (!TRON_HOT_WALLET_ADDRESS) {
    throw new Error(
      "Pooled deposit mode needs a destination: set a pooled address in admin " +
        "settings or configure TRON_HOT_WALLET_ADDRESS.",
    );
  }
  return TRON_HOT_WALLET_ADDRESS;
}

export type PooledDepositIntent = {
  /** The shared address every user deposits to in pooled mode. */
  pooledAddress: string;
  /** The EXACT amount this user must send (its fingerprint) — decimal string. */
  exactAmount: string;
  /** When the intent expires (ISO string). */
  expiresAt: string;
};

/**
 * Create a pooled/omnibus deposit intent (migration 0029): reserve a unique exact
 * amount for the user so an inbound transfer of that amount can be attributed back
 * to them. Used only when the sweep strategy is 'pooled'. The base amount is a
 * round figure the user intends to deposit; the RPC adds a tiny unique suffix.
 */
export async function createPooledDepositIntent(
  userId: string,
  baseAmount: string,
): Promise<PooledDepositIntent> {
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("create_deposit_intent", {
    p_user: userId,
    p_base_amount: baseAmount,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("failed to create deposit intent");

  return {
    pooledAddress: await resolvePooledAddress(),
    exactAmount: data.amount_usdt,
    expiresAt: data.expires_at,
  };
}

export type DepositPollResult = {
  scanned: number;
  credited: number;
  /** Confirmed transfers matching NO deposit intent (pooled mode) — these are real
   * funds that need manual reconciliation. Always 0 for per-user addresses, where
   * the address itself identifies the user. */
  unmatched: number;
};

/**
 * Cron worker: scan every assigned deposit address for confirmed inbound USDT
 * and credit the matching user. Crediting is idempotent (credit_deposit dedupes
 * on tx hash), so this is safe to run on a schedule and to re-run after a crash.
 *
 * Under the stub provider this finds nothing and credits nothing — a no-op until
 * a real chain provider is configured.
 */
export async function pollDeposits(): Promise<DepositPollResult> {
  const admin = createAdminSupabase();
  const strategy = await getSweepStrategy();

  // Pooled mode: one shared address; attribute transfers by exact amount to a
  // PENDING deposit_intent (migration 0029) instead of by per-user address.
  if (strategy === "pooled") {
    return pollPooledDeposits(admin);
  }

  const { data: wallets, error } = await admin
    .from("wallets")
    .select("user_id, deposit_address")
    .not("deposit_address", "is", null);
  if (error) throw new Error(`failed to list deposit addresses: ${error.message}`);

  const rows = (wallets ?? []) as {
    user_id: string;
    deposit_address: string;
  }[];
  if (rows.length === 0) return { scanned: 0, credited: 0, unmatched: 0 };

  // Map address → user so a transfer can be attributed back to a wallet.
  const byAddress = new Map<string, string>();
  for (const w of rows) byAddress.set(w.deposit_address, w.user_id);

  const provider = await getChainProvider();
  const transfers = await provider.fetchIncomingTransfers([
    ...byAddress.keys(),
  ]);

  let credited = 0;
  for (const t of transfers) {
    const userId = byAddress.get(t.toAddress);
    if (!userId) continue; // transfer to an address we don't own — ignore
    const { data: didCredit, error: cErr } = await admin.rpc("credit_deposit", {
      p_user: userId,
      p_tx_hash: t.txHash,
      p_amount: t.amountUsdt,
    });
    if (cErr) throw new Error(`credit_deposit failed: ${cErr.message}`);
    if (didCredit) credited += 1;
  }

  return { scanned: byAddress.size, credited, unmatched: 0 };
}

/**
 * Pooled/omnibus poller (migration 0029). Reads confirmed inbound transfers to the
 * single shared address and attributes each to a user by EXACT AMOUNT via
 * credit_pooled_deposit, which finds the matching PENDING intent, credits that
 * user (idempotent on tx hash), and marks the intent MATCHED.
 */
async function pollPooledDeposits(
  admin: ReturnType<typeof createAdminSupabase>,
): Promise<DepositPollResult> {
  const pooledAddress = await resolvePooledAddress();
  const provider = await getChainProvider();
  const transfers = await provider.fetchIncomingTransfers([pooledAddress]);

  let credited = 0;
  let unmatched = 0;
  for (const t of transfers) {
    const { data: status, error: cErr } = await admin.rpc(
      "credit_pooled_deposit",
      { p_tx_hash: t.txHash, p_amount: t.amountUsdt },
    );
    if (cErr) throw new Error(`credit_pooled_deposit failed: ${cErr.message}`);
    if (status === "credited") {
      credited += 1;
    } else if (status === "unmatched") {
      // A confirmed transfer to the shared pooled address that matches NO deposit
      // intent: the funds are real but unattributable (wrong/typo amount, or a
      // deposit sent with no intent). NEVER drop it silently — surface it loudly so
      // an operator can reconcile manually. ('duplicate' is a benign re-poll.)
      unmatched += 1;
      console.warn(
        `[deposits] UNMATCHED pooled transfer needs manual reconciliation: ` +
          `${t.amountUsdt} USDT tx=${t.txHash} → ${pooledAddress.slice(0, 8)}…`,
      );
    }
  }

  return { scanned: transfers.length, credited, unmatched };
}
