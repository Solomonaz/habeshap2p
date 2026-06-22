import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getChainProvider } from "@/lib/chain";

/**
 * Sweeper (Phase 7 ops).
 *
 * Deposits land at per-user derived addresses, but withdrawals are paid from the
 * hot wallet. To keep payout liquidity, received USDT must be forwarded from the
 * derived addresses into the hot wallet. This worker walks every assigned
 * deposit address and asks the chain provider to consolidate it.
 *
 * It NEVER touches the internal ledger — the user was already credited at
 * deposit time (see pollDeposits). Sweeping only moves on-chain USDT around so
 * the hot wallet can satisfy withdrawals. Under the stub provider every address
 * reports "skipped", so this is a safe no-op until a real provider is live.
 */

export type SweepResult = {
  scanned: number;
  swept: number;
  gassed: number;
  skipped: number;
  failed: number;
};

export async function sweepDeposits(): Promise<SweepResult> {
  const admin = createAdminSupabase();
  const { data: wallets, error } = await admin
    .from("wallets")
    .select("user_id, deposit_address")
    .not("deposit_address", "is", null);
  if (error) {
    throw new Error(`failed to list deposit addresses: ${error.message}`);
  }

  const rows = (wallets ?? []) as {
    user_id: string;
    deposit_address: string;
  }[];

  const result: SweepResult = {
    scanned: rows.length,
    swept: 0,
    gassed: 0,
    skipped: 0,
    failed: 0,
  };
  if (rows.length === 0) return result;

  const provider = await getChainProvider();

  for (const w of rows) {
    try {
      const outcome = await provider.sweepDepositAddress(
        w.user_id,
        w.deposit_address,
      );
      switch (outcome.status) {
        case "swept":
          result.swept += 1;
          console.info(
            `[sweeper] swept ${outcome.amountUsdt} USDT from ` +
              `${w.deposit_address.slice(0, 6)}… tx=${outcome.txHash}`,
          );
          break;
        case "gassed":
          result.gassed += 1;
          console.info(
            `[sweeper] gassed ${w.deposit_address.slice(0, 6)}… ` +
              `tx=${outcome.txHash} (will sweep next run)`,
          );
          break;
        case "skipped":
          result.skipped += 1;
          break;
      }
    } catch (err) {
      // One bad address must never abort the whole sweep — log and continue.
      result.failed += 1;
      console.error(
        `[sweeper] failed ${w.deposit_address.slice(0, 6)}…: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return result;
}
