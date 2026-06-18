import "server-only";
import { TRON_NETWORK } from "./config";
import type { ChainProvider } from "./provider";
import { StubChainProvider } from "./stub";

export type { ChainProvider, IncomingTransfer, SendResult } from "./provider";
export {
  TRON_NETWORK,
  TRON_NETWORK_LABEL,
  IS_TRON_MAINNET,
  WITHDRAWAL_APPROVAL_THRESHOLD,
  DEPOSIT_MIN_CONFIRMATIONS,
  needsApproval,
} from "./config";

let cached: ChainProvider | null = null;

/**
 * Resolve the active ChainProvider.
 *
 * Phase 7 always returns the StubChainProvider. When the real integration lands,
 * this is the single place to branch: if TRON_HOT_WALLET_PRIVATE_KEY + TRON_API_KEY
 * are present, construct and return the TronGrid/tronweb-backed provider here;
 * otherwise fall back to the stub. Nothing else in the app needs to change.
 */
export function getChainProvider(): ChainProvider {
  if (cached) return cached;
  // TODO(phase7-real): when TRON_HOT_WALLET_PRIVATE_KEY && TRON_API_KEY are set,
  // return new TronGridChainProvider(...) instead of the stub.
  cached = new StubChainProvider(TRON_NETWORK);
  return cached;
}
