import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getChainProvider } from "@/lib/chain";
import { getSweepStrategy } from "@/lib/settings";

/**
 * Sweeper (Phase 7 ops, Phase 9 strategies).
 *
 * Deposits land at per-user derived addresses, but withdrawals are paid from the
 * hot wallet. To keep payout liquidity, received USDT must be forwarded from the
 * derived addresses into the hot wallet. This worker walks every assigned
 * deposit address and asks the chain provider to consolidate it, using the
 * admin-selected sweep strategy (staking / rental). The strategy NEVER burns TRX:
 * Energy is delegated or rented, then the USDT is forwarded on a later run.
 *
 * In POOLED mode there are no per-user addresses to sweep (deposits land straight
 * in the hot wallet), so this is a no-op — it returns early.
 *
 * It NEVER touches the internal ledger — the user was already credited at
 * deposit time (see pollDeposits). Under the stub provider every address reports
 * "skipped", so this is a safe no-op until a real provider is live.
 */

export type SweepResult = {
  strategy: string;
  scanned: number;
  swept: number;
  /** Addresses that had gas provisioned this run (delegated, rented, or TRX-topped-up). */
  prepared: number;
  skipped: number;
  failed: number;
};

export async function sweepDeposits(): Promise<SweepResult> {
  const strategy = await getSweepStrategy();

  // Pooled mode: deposits land directly in the hot wallet — nothing to sweep.
  if (strategy === "pooled") {
    return {
      strategy,
      scanned: 0,
      swept: 0,
      prepared: 0,
      skipped: 0,
      failed: 0,
    };
  }

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
    strategy,
    scanned: rows.length,
    swept: 0,
    prepared: 0,
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
        strategy,
      );
      switch (outcome.status) {
        case "swept":
          result.swept += 1;
          console.info(
            `[sweeper] swept ${outcome.amountUsdt} USDT from ` +
              `${w.deposit_address.slice(0, 6)}… tx=${outcome.txHash}`,
          );
          break;
        case "delegated":
          result.prepared += 1;
          console.info(
            `[sweeper] delegated Energy to ${w.deposit_address.slice(0, 6)}… ` +
              `tx=${outcome.txHash} (will sweep next run)`,
          );
          break;
        case "rented":
          result.prepared += 1;
          console.info(
            `[sweeper] rented Energy for ${w.deposit_address.slice(0, 6)}… ` +
              `ref=${outcome.txHash ?? "?"} (will sweep next run)`,
          );
          break;
        case "gassed":
          result.prepared += 1;
          console.info(
            `[sweeper] topped up gas (burn) for ${w.deposit_address.slice(0, 6)}… ` +
              `tx=${outcome.txHash} (will sweep next run)`,
          );
          break;
        case "skipped":
          result.skipped += 1;
          // Surface non-trivial skips (e.g. "no staked energy") so an operator
          // notices a misconfigured strategy instead of silently stalled funds.
          if (outcome.reason && outcome.reason !== "no USDT") {
            console.warn(
              `[sweeper] skipped ${w.deposit_address.slice(0, 6)}…: ${outcome.reason}`,
            );
          }
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
