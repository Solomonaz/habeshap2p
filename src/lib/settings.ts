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
  release_window_minutes: number | null;
  withdrawal_fee_usdt: string | null;
  seller_fee_bps: number | null;
  internal_transfer_fee_usdt: string | null;
  referral_bps: number | null;
  referral_max_trades: number | null;
  sweep_strategy: string | null;
  pooled_deposit_address: string | null;
};

const SETTINGS_COLUMNS =
  "live_payments, fee_bps, fee_min_usdt, fee_max_usdt, min_merchant_bond, " +
  "trade_limit_new, trade_limit_active, trade_limit_established, " +
  "tier_active_trades, tier_established_trades, order_ttl_minutes, " +
  "release_window_minutes, withdrawal_fee_usdt, seller_fee_bps, " +
  "internal_transfer_fee_usdt, referral_bps, referral_max_trades, " +
  "sweep_strategy, pooled_deposit_address";

let lastKnownRow: SettingsRow | null = null;

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
      // If a database read hiccup occurs, fall back to the last known valid row to avoid unintended mode flips.
      if (lastKnownRow) {
        return lastKnownRow;
      }
      return null;
    }
    if (data) {
      lastKnownRow = data as unknown as SettingsRow;
    }
    return (data as unknown as SettingsRow | null) ?? lastKnownRow;
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
 * Is the platform in LIVE (real-money) mode? The real-money kill-switch.
 *
 * Read FRESH and uncached every time, straight from the DB — never via the cached
 * settings row, an env override, or a last-known-row fallback. Those can mask the
 * admin's toggle and keep the platform moving real money after it was switched off
 * (which is exactly what an env FORCE override did). The DB flag is the single
 * source of truth. FAIL-SAFE: any read error returns false (TEST mode), so a glitch
 * can never silently keep real money on.
 */
export async function isLivePaymentsEnabled(): Promise<boolean> {
  const admin = createAdminSupabase();
  // A single transient read failure — a serverless cold-start connection, a
  // momentary Supabase blip — must NOT flip the platform to TEST ("live turns to
  // test by itself"). Retry a few times; only when the DB genuinely can't be read
  // do we fall back to the safe TEST default (never move real money unconfirmed).
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await admin
      .from("platform_settings")
      .select("live_payments")
      .eq("id", true)
      .maybeSingle();
    if (!error) return data?.live_payments === true;
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  console.error(
    "[settings] live_payments unreadable after retries — defaulting to TEST mode",
  );
  return false;
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

/** The default seller release window (minutes) — mirrors the SQL default. */
export const DEFAULT_RELEASE_WINDOW_MINUTES = 30;

/**
 * Read the configured seller release window in minutes (migration 0042) — how
 * long the seller has to confirm + release AFTER the buyer marks paid. order_mark_paid
 * reads this live and stamps a fresh deadline, so it drives the PAID-order countdown
 * and the auto-freeze. FAIL-SAFE: any read error returns the 30-minute default that
 * order_mark_paid itself falls back to.
 */
export async function getReleaseWindowMinutes(): Promise<number> {
  const row = await getSettingsRow();
  if (!row || row.release_window_minutes == null) {
    return DEFAULT_RELEASE_WINDOW_MINUTES;
  }
  return row.release_window_minutes;
}

/**
 * Set the seller release window. Goes through the service-role RPC, which
 * re-checks is_admin and validates the input (at least 1 minute). The caller must
 * already have verified the actor is an admin (see the admin action).
 */
export async function setReleaseWindowMinutes(
  adminId: string,
  minutes: number,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("set_release_window", {
    p_admin: adminId,
    p_minutes: minutes,
  });
  if (error) throw new Error(error.message);
  revalidateTag("platform-settings");
}

/** The default flat withdrawal fee (USDT) — mirrors the SQL default. */
export const DEFAULT_WITHDRAWAL_FEE_USDT = "1";

/**
 * Read the configured flat withdrawal fee in USDT (migration 0045) — deducted
 * from every withdrawal so the user covers on-chain gas. Kept as an exact-decimal
 * string. FAIL-SAFE: any read error returns the SQL default so the fee can never
 * silently vanish (which would make the platform eat the gas).
 */
export async function getWithdrawalFee(): Promise<string> {
  const row = await getSettingsRow();
  return row?.withdrawal_fee_usdt ?? DEFAULT_WITHDRAWAL_FEE_USDT;
}

/**
 * Set the flat withdrawal fee. Goes through the service-role RPC, which re-checks
 * is_admin and validates the input (≥ 0). The caller must already have verified
 * the actor is an admin (see the admin action).
 */
export async function setWithdrawalFee(
  adminId: string,
  feeUsdt: string,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("set_withdrawal_fee", {
    p_admin: adminId,
    p_fee: feeUsdt,
  });
  if (error) throw new Error(error.message);
  revalidateTag("platform-settings");
}

/**
 * The seller-side trade fee in basis points (migration 0049). Charged to the
 * seller (from their available balance) on a completed trade — 0 disables it.
 * FAIL-SAFE: any read error returns 0 so a hiccup can never over-charge sellers.
 */
export async function getSellerFeeBps(): Promise<number> {
  const row = await getSettingsRow();
  return row?.seller_fee_bps ?? 0;
}

/** Set the seller-side trade fee (bps). Admin-gated in SQL. */
export async function setSellerFee(adminId: string, bps: number): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("set_seller_fee", {
    p_admin: adminId,
    p_bps: bps,
  });
  if (error) throw new Error(error.message);
  revalidateTag("platform-settings");
}

/**
 * The flat internal-transfer fee in USDT (migration 0049) — deducted from a
 * transfer so the recipient gets amount − fee. "0" = free. FAIL-SAFE to "0".
 */
export async function getInternalTransferFee(): Promise<string> {
  const row = await getSettingsRow();
  return row?.internal_transfer_fee_usdt ?? "0";
}

/**
 * The referral reward rate (migration 0050) in basis points — the share of the
 * platform fee credited to a referrer on their referral's completed trade
 * (2000 = 20%). FAIL-SAFE: any read error returns 0, so a hiccup can never
 * over-pay referrers.
 */
export async function getReferralBps(): Promise<number> {
  const row = await getSettingsRow();
  return row?.referral_bps ?? 0;
}

/** Set the referral reward rate (bps). Admin-gated in SQL. */
export async function setReferralBps(
  adminId: string,
  bps: number,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("set_referral_bps", {
    p_admin: adminId,
    p_bps: bps,
  });
  if (error) throw new Error(error.message);
  revalidateTag("platform-settings");
}

/**
 * How many of a referee's first completed trades earn their referrer a reward
 * (migration 0051). 0 = unlimited (lifetime). FAIL-SAFE to the default of 10.
 */
export async function getReferralMaxTrades(): Promise<number> {
  const row = await getSettingsRow();
  return row?.referral_max_trades ?? 10;
}

/** Set the referral reward window (first N trades; 0 = unlimited). Admin-gated. */
export async function setReferralMaxTrades(
  adminId: string,
  n: number,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("set_referral_max_trades", {
    p_admin: adminId,
    p_n: n,
  });
  if (error) throw new Error(error.message);
  revalidateTag("platform-settings");
}

/** Set the flat internal-transfer fee. Admin-gated in SQL. */
export async function setInternalTransferFee(
  adminId: string,
  feeUsdt: string,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("set_internal_transfer_fee", {
    p_admin: adminId,
    p_fee: feeUsdt,
  });
  if (error) throw new Error(error.message);
  revalidateTag("platform-settings");
}

/**
 * The admin-selectable deposit-gas strategy (migration 0029) — how the sweeper
 * provisions Energy for consolidating a deposit address, or whether it pools
 * deposits and skips sweeping entirely:
 *
 *   staking — delegate Energy from the hot wallet's frozen TRX (no burn).
 *   rental  — rent Energy from an external market for the sweep.
 *   burn    — send the deposit address TRX to be burned as Energy on the transfer.
 *   pooled  — one shared deposit address, no per-user sweep at all.
 */
export type SweepStrategy = "staking" | "rental" | "burn" | "pooled";

/** Default strategy when the settings row can't be read — mirrors the SQL default. */
export const DEFAULT_SWEEP_STRATEGY: SweepStrategy = "staking";

const SWEEP_STRATEGIES: readonly SweepStrategy[] = [
  "staking",
  "rental",
  "burn",
  "pooled",
];

/**
 * Read the configured sweep strategy. Service-role read (it drives the sweeper and
 * the deposit flow). FAIL-SAFE: any read error or an unrecognized value falls back
 * to 'staking' (the SQL default), which never burns TRX.
 */
export async function getSweepStrategy(): Promise<SweepStrategy> {
  const row = await getSettingsRow();
  const raw = row?.sweep_strategy;
  return SWEEP_STRATEGIES.includes(raw as SweepStrategy)
    ? (raw as SweepStrategy)
    : DEFAULT_SWEEP_STRATEGY;
}

/**
 * The shared pooled deposit address override (migration 0029), or null to use the
 * configured hot-wallet address. Only meaningful in 'pooled' strategy.
 */
export async function getPooledDepositAddress(): Promise<string | null> {
  const row = await getSettingsRow();
  return row?.pooled_deposit_address ?? null;
}

/**
 * Set the sweep strategy (and, for pooled mode, an optional shared-address
 * override). Goes through the service-role RPC, which re-checks is_admin and
 * validates the enum. The caller must already have verified the actor is an admin
 * (see the admin action).
 */
export async function setSweepStrategy(
  adminId: string,
  strategy: SweepStrategy,
  pooledAddress?: string | null,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("set_sweep_strategy", {
    p_admin: adminId,
    p_strategy: strategy,
    p_pooled_address: pooledAddress ?? null,
  });
  if (error) throw new Error(error.message);
  revalidateTag("platform-settings");
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
