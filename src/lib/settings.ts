import "server-only";
import { cache } from "react";
import { unstable_cache, revalidateTag } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { DEFAULT_TRADE_POLICY, type TradePolicy } from "@/lib/reputation";

/**
 * `platform_settings` is a single-row table read by almost every page (the live
 * flag, the fee, the trade policy, the order window). Reading each field with a
 * separate query meant 2-4 network round-trips per render to the same one row —
 * a meaningful slice of page latency.
 *
 * This loader reads the whole row ONCE and the typed getters below derive their
 * values from it. Two layers of caching:
 *   • `unstable_cache` — shares the result across requests/users for 30s, so the
 *     row is fetched at most ~twice a minute platform-wide instead of per page.
 *     Settings change rarely (admin action), and the money-critical math reads
 *     settings directly in the SQL RPCs (order_release/order_create), not here —
 *     these getters drive UI + provider selection, where 30s staleness is fine.
 *   • `cache` (React) — dedupes within a single render so multiple getters on one
 *     page collapse to a single underlying call.
 *
 * Returns the raw row or null; the getters apply fail-safe defaults so a missing
 * table (pre-migration) or read error degrades to TEST-mode defaults, never an
 * unsafe state.
 */
type SettingsRow = {
  live_payments: boolean | null;
  fee_bps: number | null;
  fee_min_usdt: string | null;
  fee_max_usdt: string | null;
  min_merchant_bond: string | null;
  trade_limit_new: string | null;
  trade_limit_active: string | null;
  trade_limit_established: string | null;
  tier_active_trades: number | null;
  tier_established_trades: number | null;
  order_ttl_minutes: number | null;
};

const SETTINGS_COLUMNS =
  "live_payments, fee_bps, fee_min_usdt, fee_max_usdt, min_merchant_bond, " +
  "trade_limit_new, trade_limit_active, trade_limit_established, " +
  "tier_active_trades, tier_established_trades, order_ttl_minutes";

const loadSettingsRow = unstable_cache(
  async (): Promise<SettingsRow | null> => {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("platform_settings")
      .select(SETTINGS_COLUMNS)
      .eq("id", true)
      .maybeSingle();
    if (error) {
      // Before migration 0018 the table doesn't exist — a normal pre-migration
      // state, not a fault (PostgREST reports PGRST205). Stay quiet for that;
      // log anything else. Either way the caller falls back to safe defaults.
      const missingTable =
        error.code === "PGRST205" ||
        /platform_settings/.test(error.message ?? "");
      if (!missingTable) {
        console.error(`[settings] failed to read settings row: ${error.message}`);
      }
      return null;
    }
    return (data as SettingsRow | null) ?? null;
  },
  ["platform-settings-row"],
  { revalidate: 30, tags: ["platform-settings"] },
);

/** Per-request memo over the cross-request cache (belt-and-braces dedupe). */
const getSettingsRow = cache(loadSettingsRow);

/**
 * Platform runtime settings (Phase 9) — currently just the "live payments"
 * switch the admin flips from the console.
 *
 *   live payments OFF  →  TEST mode: the dev faucet is available and the
 *                         no-network StubChainProvider backs deposits/withdrawals.
 *   live payments ON   →  LIVE mode: the faucet is gone and the real Tron
 *                         provider moves money on-chain.
 *
 * Read with the service role (the flag drives provider selection in trusted
 * server code); written only through the admin-gated set_live_payments RPC.
 */

/**
 * Is the platform in LIVE (real-money) mode? Service-role read.
 *
 * FAIL-SAFE: any read error returns false (TEST mode). We must never silently
 * fall into moving real money because a settings read hiccuped — and in TEST
 * mode the production faucet is still hard-blocked by NODE_ENV, so a false
 * negative is harmless, while a false positive would be dangerous.
 */
export async function isLivePaymentsEnabled(): Promise<boolean> {
  const row = await getSettingsRow();
  return row?.live_payments === true;
}

/**
 * Flip the live-payments switch. Goes through the service-role RPC, which
 * re-checks is_admin (defence in depth). The caller must already have verified
 * the actor is an admin and — when enabling — that the chain provider is
 * configured (see the admin action).
 */
export async function setLivePayments(
  adminId: string,
  enabled: boolean,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("set_live_payments", {
    p_admin: adminId,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
  // Drop the cached settings row so the change takes effect at once, not in 30s.
  revalidateTag("platform-settings");
}

/**
 * The admin-configured per-trade commission fee (migration 0020). The fee is a
 * percentage of the trade amount (`bps`, basis points), clamped to an optional
 * [min, max] band in USDT. `bps = 0` disables the fee entirely.
 *
 * `min`/`max` are decimal USDT strings ("0" = no floor; max `null` = no cap),
 * kept as strings so the exact-decimal money helpers handle them, never floats.
 */
export type PlatformFee = {
  bps: number;
  min: string;
  max: string | null;
};

/** Default fee when the settings row can't be read — mirrors the SQL default. */
const DEFAULT_FEE: PlatformFee = { bps: 25, min: "0", max: null };

/**
 * Read the configured taker fee. Service-role read (it drives release math and
 * the admin UI). FAIL-SAFE: any read error falls back to the 25 bps default —
 * the same value `order_release` itself defaults to — so a settings hiccup can
 * never silently zero out platform revenue or block a release.
 */
export async function getPlatformFee(): Promise<PlatformFee> {
  const row = await getSettingsRow();
  if (!row) return DEFAULT_FEE;
  return {
    bps: row.fee_bps ?? DEFAULT_FEE.bps,
    min: row.fee_min_usdt ?? DEFAULT_FEE.min,
    max: row.fee_max_usdt ?? DEFAULT_FEE.max,
  };
}

/**
 * Set the taker fee. Goes through the service-role RPC, which re-checks is_admin
 * and validates the band (min ≤ max, both non-negative, bps in 0–10000). The
 * caller must already have verified the actor is an admin (see the admin action).
 */
export async function setPlatformFee(
  adminId: string,
  fee: PlatformFee,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("set_platform_fee", {
    p_admin: adminId,
    p_fee_bps: fee.bps,
    p_fee_min: fee.min,
    p_fee_max: fee.max,
  });
  if (error) throw new Error(error.message);
  revalidateTag("platform-settings");
}

/**
 * Read the configured trade policy (migration 0021) — the merchant-bond minimum,
 * the per-order caps, and the tier thresholds. Service-role read. FAIL-SAFE: any
 * read error returns the built-in defaults (matching the SQL fallback), so the
 * limits can never silently vanish. Cap columns of `null` mean "unlimited".
 */
export async function getTradePolicy(): Promise<TradePolicy> {
  const row = await getSettingsRow();
  if (!row) return DEFAULT_TRADE_POLICY;
  const num = (
    v: string | number | null,
    fallback: number | null,
  ): number | null => (v === null || v === undefined ? fallback : Number(v));
  return {
    minMerchantBond:
      num(row.min_merchant_bond, DEFAULT_TRADE_POLICY.minMerchantBond) ??
      DEFAULT_TRADE_POLICY.minMerchantBond,
    newCap: num(row.trade_limit_new, DEFAULT_TRADE_POLICY.newCap),
    activeCap: num(row.trade_limit_active, DEFAULT_TRADE_POLICY.activeCap),
    establishedCap: num(
      row.trade_limit_established,
      DEFAULT_TRADE_POLICY.establishedCap,
    ),
    activeAfter: row.tier_active_trades ?? DEFAULT_TRADE_POLICY.activeAfter,
    establishedAfter:
      row.tier_established_trades ?? DEFAULT_TRADE_POLICY.establishedAfter,
  };
}

/**
 * Set the trade policy. Goes through the service-role RPC, which re-checks
 * is_admin and validates the inputs (positive bond, sane tier order, non-negative
 * caps). `null` caps mean "unlimited". The caller must already have verified the
 * actor is an admin (see the admin action).
 */
export async function setTradePolicy(
  adminId: string,
  policy: TradePolicy,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("set_trade_policy", {
    p_admin: adminId,
    p_min_bond: String(policy.minMerchantBond),
    p_limit_new: policy.newCap === null ? null : String(policy.newCap),
    p_limit_active: policy.activeCap === null ? null : String(policy.activeCap),
    p_limit_established:
      policy.establishedCap === null ? null : String(policy.establishedCap),
    p_active_trades: policy.activeAfter,
    p_established_trades: policy.establishedAfter,
  });
  if (error) throw new Error(error.message);
  revalidateTag("platform-settings");
}

/** The default order payment window (minutes) — mirrors the SQL default. */
export const DEFAULT_ORDER_TTL_MINUTES = 15;

/**
 * Read the configured order payment window in minutes (migration 0022) — how
 * long a CREATED order may sit unpaid before it is eligible for auto-cancel.
 * Service-role read (it drives the order deadline and the UI countdown copy).
 * FAIL-SAFE: any read error returns the 15-minute default that order_create
 * itself falls back to, so the window can never silently vanish.
 */
export async function getOrderTtlMinutes(): Promise<number> {
  const row = await getSettingsRow();
  if (!row || row.order_ttl_minutes == null) {
    return DEFAULT_ORDER_TTL_MINUTES;
  }
  return row.order_ttl_minutes;
}

/**
 * Set the order payment window. Goes through the service-role RPC, which
 * re-checks is_admin and validates the input (at least 1 minute). The caller
 * must already have verified the actor is an admin (see the admin action).
 */
export async function setOrderTtlMinutes(
  adminId: string,
  minutes: number,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("set_order_ttl", {
    p_admin: adminId,
    p_minutes: minutes,
  });
  if (error) throw new Error(error.message);
  revalidateTag("platform-settings");
}
