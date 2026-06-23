/**
 * Reputation tiers and new-user trade limits (Phase 6, rule #5).
 *
 * The AUTHORITATIVE limit check lives in SQL — `_trade_limit_usdt` inside
 * order_create (migration 0011) rejects any order that exceeds a party's cap, so
 * a client that skips these helpers still cannot trade over the limit. The
 * functions here mirror that SQL so the UI can SHOW the cap and label a tier
 * before the user submits. KEEP THE TWO IN SYNC: if you change the thresholds
 * here, change `_trade_limit_usdt` too (and vice-versa).
 *
 * No money math happens here, only tier classification, so plain numbers are
 * fine — these limits are not balances.
 */

/**
 * The admin-configurable trade policy (migration 0021): the merchant-bond
 * minimum, the three per-order caps, and the completed-trade thresholds that
 * promote a user between tiers. A cap of `null` means "unlimited" for that tier
 * (merchants are always unlimited regardless). Mirrors the columns on the
 * platform_settings singleton; the AUTHORITATIVE values live in SQL.
 */
export type TradePolicy = {
  minMerchantBond: number;
  newCap: number | null;
  activeCap: number | null;
  establishedCap: number | null;
  activeAfter: number;
  establishedAfter: number;
};

/**
 * The built-in defaults — identical to the hardcoded values before 0021, and
 * to the SQL column defaults. Used when no live policy is supplied (tests, and
 * the fail-safe fallback if a settings read hiccups).
 */
export const DEFAULT_TRADE_POLICY: TradePolicy = {
  minMerchantBond: 500,
  newCap: 100,
  activeCap: 1000,
  establishedCap: 10000,
  activeAfter: 1,
  establishedAfter: 10,
};

/** @deprecated Use the live policy's `minMerchantBond`. Kept as the default. */
export const MIN_MERCHANT_BOND = DEFAULT_TRADE_POLICY.minMerchantBond;

export type ReputationTier = "MERCHANT" | "ESTABLISHED" | "ACTIVE" | "NEW";

export type ReputationInputs = {
  isMerchant: boolean;
  completedTrades: number;
};

/**
 * The per-order USDT cap for a user. `null` means unlimited (a bonded merchant,
 * or a tier the admin set to unlimited). Mirrors `_trade_limit_usdt`:
 *   merchant                         -> unlimited (null)
 *   >= establishedAfter trades        -> establishedCap
 *   >= activeAfter trades             -> activeCap
 *   brand-new                         -> newCap
 */
export function tradeLimitUsdt(
  { isMerchant, completedTrades }: ReputationInputs,
  policy: TradePolicy = DEFAULT_TRADE_POLICY,
): number | null {
  if (isMerchant) return null;
  if (completedTrades >= policy.establishedAfter) return policy.establishedCap;
  if (completedTrades >= policy.activeAfter) return policy.activeCap;
  return policy.newCap;
}

/** A human-facing tier label derived from the same inputs as the limit. */
export function reputationTier(
  { isMerchant, completedTrades }: ReputationInputs,
  policy: TradePolicy = DEFAULT_TRADE_POLICY,
): ReputationTier {
  if (isMerchant) return "MERCHANT";
  if (completedTrades >= policy.establishedAfter) return "ESTABLISHED";
  if (completedTrades >= policy.activeAfter) return "ACTIVE";
  return "NEW";
}

const TIER_LABELS: Record<ReputationTier, string> = {
  MERCHANT: "Merchant",
  ESTABLISHED: "Established trader",
  ACTIVE: "Active trader",
  NEW: "New trader",
};

export function tierLabel(tier: ReputationTier): string {
  return TIER_LABELS[tier];
}

/** "Unlimited" for a merchant, otherwise the cap formatted as a USDT string. */
export function formatTradeLimit(limit: number | null): string {
  return limit === null ? "Unlimited" : `${limit.toLocaleString("en-US")} USDT`;
}
