/**
 * Domain enums mirrored from the Postgres schema (see supabase/migrations).
 * Keep these in lockstep with the SQL enum types.
 */

export const AD_SIDES = ["BUY", "SELL"] as const;
export type AdSide = (typeof AD_SIDES)[number];

export const AD_STATUSES = ["ACTIVE", "PAUSED", "CLOSED"] as const;
export type AdStatus = (typeof AD_STATUSES)[number];

/**
 * Order lifecycle. Transitions are enforced server-side, never by the client:
 *   CREATED   → PAID | CANCELLED | DISPUTED
 *   PAID      → RELEASED | DISPUTED
 *   DISPUTED  → RELEASED (favour buyer) | CANCELLED (favour seller)
 *   RELEASED  → (terminal)
 *   CANCELLED → (terminal)
 */
export const ORDER_STATES = [
  "CREATED",
  "PAID",
  "RELEASED",
  "CANCELLED",
  "DISPUTED",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

/**
 * Append-only ledger entry kinds. LOCK/UNLOCK/RELEASE/FEE move funds between a
 * user's available and locked balances; DEPOSIT/WITHDRAW reflect on-chain flow.
 * NOTE: UNLOCK is an addition to the spec's five types — the spec describes the
 * cancel-time reversal but did not name it; an explicit entry keeps the trail
 * auditable. Flagged in the Phase 0 summary.
 */
export const LEDGER_TYPES = [
  "LOCK",
  "UNLOCK",
  "RELEASE",
  "FEE",
  "DEPOSIT",
  "WITHDRAW",
  // Phase 6: merchant collateral bond moves.
  "BOND_LOCK",
  "BOND_RELEASE",
  // Phase 7: the off-ramp hold (available → reserved) and its refund reversal.
  "WITHDRAW_LOCK",
  "WITHDRAW_UNLOCK",
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

/** Whitelisted irreversible payment rails only (spec rule #3). */
export const PAYMENT_METHODS = [
  "TELEBIRR",
  "MPESA",
  "CBE_BIRR",
  "CBE",
  "AWASH",
  "DASHEN",
  "ABYSSINIA",
  "WEGAGEN",
  "HIBRET",
  "NIB",
  "ZEMEN",
  "BUNNA",
  "OROMIA",
  "COOP_OROMIA",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Mobile-wallet rails — these are identified by a PHONE NUMBER. Everything else
 * in PAYMENT_METHODS is a bank account (identified by an ACCOUNT NUMBER). Used to
 * adapt the account-entry field label ("Phone number" vs "Bank account number").
 */
export const WALLET_METHODS = ["TELEBIRR", "MPESA", "CBE_BIRR"] as const;

export function isWalletMethod(method: string): boolean {
  return (WALLET_METHODS as readonly string[]).includes(method);
}

export const DISPUTE_STATUSES = ["OPEN", "UNDER_REVIEW", "RESOLVED"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const DISPUTE_RESOLUTIONS = ["FAVOUR_BUYER", "FAVOUR_SELLER"] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];

export const CHAIN_DIRECTIONS = ["IN", "OUT"] as const;
export type ChainDirection = (typeof CHAIN_DIRECTIONS)[number];

/**
 * Withdrawal lifecycle (Phase 7). A request holds funds; the signer broadcasts;
 * confirmation finalises. Admin approval gates amounts over the threshold.
 *   PENDING_APPROVAL → APPROVED | REJECTED
 *   APPROVED         → SENT | FAILED
 *   SENT             → CONFIRMED
 */
export const WITHDRAWAL_STATUSES = [
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "CONFIRMED",
  "REJECTED",
  "FAILED",
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

/** USDT (TRC-20) has 6 decimal places. All amounts are exact decimals, not floats. */
export const USDT_DECIMALS = 6;

/** Launch taker fee skimmed from escrow at release (spec §6: ~0.25%). */
export const TAKER_FEE_RATE = 0.0025;
