import { toMicros } from "@/lib/money";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Platform ops stats (Phase 8). The heavy aggregation lives in the SQL function
 * `platform_stats` (service-role only); this module wraps it and exposes a pure
 * helper that re-derives the conservation figures in exact micro-USDT so the
 * dashboard never trusts a JSON-float sum.
 */

export type PlatformStats =
  Database["public"]["Functions"]["platform_stats"]["Returns"];

export type ReserveSummary = {
  /** What the platform owes users: available + locked + bond + withdraw_locked. */
  liabilitiesMicros: bigint;
  /** The platform's own accrued fees. */
  platformFeesMicros: bigint;
  /** liabilities + fees — the conserved total the on-chain reserve must back. */
  totalSupplyMicros: bigint;
  /**
   * True iff the figures SQL reported (`liabilities`, `total_supply`) match the
   * sums we re-derive from the individual buckets in exact micros. A false here
   * means the snapshot is internally inconsistent — a reconciliation red flag,
   * not a normal state — so the console can surface it loudly.
   */
  reconciles: boolean;
};

/**
 * Re-derive the conservation figures from the raw stat strings using exact
 * BigInt micros and cross-check them against the totals SQL reported. Pure (no
 * I/O) so it can be unit-tested and reused in the UI.
 */
export function summarizeReserves(stats: {
  available: string;
  locked: string;
  bond: string;
  withdraw_locked: string;
  platform_fees: string;
  liabilities: string;
  total_supply: string;
}): ReserveSummary {
  const liabilitiesMicros =
    toMicros(stats.available) +
    toMicros(stats.locked) +
    toMicros(stats.bond) +
    toMicros(stats.withdraw_locked);
  const platformFeesMicros = toMicros(stats.platform_fees);
  const totalSupplyMicros = liabilitiesMicros + platformFeesMicros;
  const reconciles =
    liabilitiesMicros === toMicros(stats.liabilities) &&
    totalSupplyMicros === toMicros(stats.total_supply);
  return {
    liabilitiesMicros,
    platformFeesMicros,
    totalSupplyMicros,
    reconciles,
  };
}
