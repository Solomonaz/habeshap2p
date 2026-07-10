/**
 * Chain configuration — network selection and the withdrawal approval policy.
 *
 * No secrets are read here (those live behind getServerEnv / the real provider),
 * so this module is safe to import from the client and from tests. It only holds
 * the non-sensitive knobs: which Tron network we target and the USDT amount at or
 * above which a withdrawal needs manual admin sign-off (rule #6).
 */

export type TronNetwork = "nile" | "shasta" | "mainnet";

/** Default to the Nile testnet — no real funds at risk until explicitly flipped. */
export const TRON_NETWORK: TronNetwork =
  (process.env.NEXT_PUBLIC_TRON_NETWORK as TronNetwork) ?? "nile";

export const IS_TRON_MAINNET = TRON_NETWORK === "mainnet";

/** Human label for the network, shown next to the deposit address. */
export const TRON_NETWORK_LABEL: Record<TronNetwork, string> = {
  nile: "Tron Nile testnet",
  shasta: "Tron Shasta testnet",
  mainnet: "Tron mainnet",
};

/**
 * Fallback withdrawal approval threshold (USDT). The live value is admin-configured
 * in platform_settings (migration 0060) and read via getWithdrawalApprovalThreshold;
 * this constant is only the fail-safe default when that read can't happen (and the
 * SQL column's default). Withdrawals whose total (amount + fee) is at or above the
 * threshold need admin sign-off before the signer broadcasts them.
 */
export const DEFAULT_WITHDRAWAL_APPROVAL_THRESHOLD = 500;

/** Number of on-chain confirmations a deposit needs before we credit it. */
export const DEPOSIT_MIN_CONFIRMATIONS = Number(
  process.env.TRON_MIN_CONFIRMATIONS ?? 20,
);

/** Pure predicate mirroring the SQL gate: does this amount need admin approval? */
export function needsApproval(
  amountUsdt: number,
  threshold: number = DEFAULT_WITHDRAWAL_APPROVAL_THRESHOLD,
): boolean {
  return amountUsdt >= threshold;
}
