import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { getChainProvider } from "@/lib/chain";

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

export type DepositPollResult = { scanned: number; credited: number };

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
  const { data: wallets, error } = await admin
    .from("wallets")
    .select("user_id, deposit_address")
    .not("deposit_address", "is", null);
  if (error) throw new Error(`failed to list deposit addresses: ${error.message}`);

  const rows = (wallets ?? []) as {
    user_id: string;
    deposit_address: string;
  }[];
  if (rows.length === 0) return { scanned: 0, credited: 0 };

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

  return { scanned: byAddress.size, credited };
}
