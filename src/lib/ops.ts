import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { PlatformStats } from "@/lib/platform";

/**
 * Ops snapshot for the admin console (Phase 8). Service-role read — the caller
 * must have already verified the user is an admin. Delegates the aggregation to
 * the `platform_stats` SQL function, which returns every amount as an exact
 * decimal string (no JSON-float rounding in a reconciliation number).
 */
export async function fetchPlatformStats(): Promise<PlatformStats> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("platform_stats");
  if (error) throw new Error(`failed to load platform stats: ${error.message}`);
  if (!data) throw new Error("platform_stats returned no data");
  return data as PlatformStats;
}

/** Platform income broken down by source (migration 0057), exact strings. */
export type IncomeBreakdown = {
  tradeFees: string;
  withdrawalFees: string;
  transferFees: string;
  referralPayouts: string;
  net: string;
};

/**
 * Where the platform's revenue comes from: trade / withdrawal / transfer fees,
 * less referral payouts. `net` equals platform_account.usdt_fees. Service-role
 * read; caller must already be an admin.
 */
export async function getIncomeBreakdown(): Promise<IncomeBreakdown> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("admin_income_breakdown");
  if (error) throw new Error(`failed to load income: ${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as
    | {
        trade_fees: string;
        withdrawal_fees: string;
        transfer_fees: string;
        referral_payouts: string;
        net: string;
      }
    | undefined;
  return {
    tradeFees: String(r?.trade_fees ?? "0"),
    withdrawalFees: String(r?.withdrawal_fees ?? "0"),
    transferFees: String(r?.transfer_fees ?? "0"),
    referralPayouts: String(r?.referral_payouts ?? "0"),
    net: String(r?.net ?? "0"),
  };
}
