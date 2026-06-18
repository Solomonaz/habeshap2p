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

/** Minimum bond (USDT) to hold merchant status — mirrors merchant_post_bond. */
export const MIN_MERCHANT_BOND = 500;

export type ReputationTier = "MERCHANT" | "ESTABLISHED" | "ACTIVE" | "NEW";

export type ReputationInputs = {
  isMerchant: boolean;
  completedTrades: number;
};

/**
 * The per-order USDT cap for a user. `null` means unlimited (a bonded
 * merchant). Mirrors `_trade_limit_usdt` exactly:
 *   merchant              -> unlimited (null)
 *   >= 10 completed trades -> 10,000
 *   >=  1 completed trade  ->  1,000
 *   brand-new (0 trades)   ->    100
 */
export function tradeLimitUsdt({
  isMerchant,
  completedTrades,
}: ReputationInputs): number | null {
  if (isMerchant) return null;
  if (completedTrades >= 10) return 10000;
  if (completedTrades >= 1) return 1000;
  return 100;
}

/** A human-facing tier label derived from the same inputs as the limit. */
export function reputationTier({
  isMerchant,
  completedTrades,
}: ReputationInputs): ReputationTier {
  if (isMerchant) return "MERCHANT";
  if (completedTrades >= 10) return "ESTABLISHED";
  if (completedTrades >= 1) return "ACTIVE";
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
