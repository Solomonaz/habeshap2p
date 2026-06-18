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
 * Withdrawals of this many USDT or more require an admin to approve before the
 * signer will broadcast them. The SQL (`withdrawal_request`) is authoritative —
 * it receives this value and sets PENDING_APPROVAL vs APPROVED — but the constant
 * lives here so the UI can warn the user up front. KEEP IN SYNC with the value
 * passed to withdrawal_request.
 */
export const WITHDRAWAL_APPROVAL_THRESHOLD = Number(
  process.env.WITHDRAWAL_APPROVAL_THRESHOLD ?? 500,
);

/** Number of on-chain confirmations a deposit needs before we credit it. */
export const DEPOSIT_MIN_CONFIRMATIONS = Number(
  process.env.TRON_MIN_CONFIRMATIONS ?? 20,
);

/** Pure predicate mirroring the SQL gate: does this amount need admin approval? */
export function needsApproval(
  amountUsdt: number,
  threshold: number = WITHDRAWAL_APPROVAL_THRESHOLD,
): boolean {
  return amountUsdt >= threshold;
}
