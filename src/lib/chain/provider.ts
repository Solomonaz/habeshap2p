import type { TronNetwork } from "./config";

/**
 * The seam between our ledger logic and the actual Tron chain.
 *
 * Everything money-on-chain goes through this interface so the rest of the app
 * (deposit poller, withdrawal signer, deposit-address assignment) is written
 * once and is agnostic to HOW we talk to Tron. Phase 7 ships a no-network
 * StubChainProvider; a TronGrid + tronweb implementation drops in behind the
 * same interface when keys are configured (see getChainProvider).
 *
 * IMPORTANT: a real implementation signs with the hot-wallet key, which is read
 * ONLY from the server secret store inside that implementation — never passed in
 * from a caller, never logged, never sent to the client (rule #6).
 */

/** A confirmed inbound USDT transfer the poller should credit. */
export type IncomingTransfer = {
  /** Tron transaction hash — unique; used to dedupe crediting. */
  txHash: string;
  /** The deposit address the funds arrived at (maps back to a user). */
  toAddress: string;
  /** Amount in USDT as an exact decimal string (never a float). */
  amountUsdt: string;
};

export type SendResult = { txHash: string };

export interface ChainProvider {
  readonly network: TronNetwork;

  /**
   * Deterministically produce (or look up) the deposit address for a user. Must
   * be stable for a given user so their address never changes between calls.
   */
  deriveDepositAddress(userId: string): Promise<string>;

  /**
   * Return confirmed inbound USDT transfers to any of the given deposit
   * addresses. Implementations should only return transfers past the required
   * confirmation depth; crediting is idempotent on txHash regardless.
   */
  fetchIncomingTransfers(addresses: string[]): Promise<IncomingTransfer[]>;

  /**
   * Sign and broadcast a TRC-20 USDT transfer from the hot wallet to a
   * destination address. Returns the broadcast tx hash. Throws if signing or
   * broadcast fails (the caller refunds the on-hold balance).
   */
  sendUsdt(toAddress: string, amountUsdt: string): Promise<SendResult>;

  /** Whether a previously broadcast tx has reached confirmation. */
  isConfirmed(txHash: string): Promise<boolean>;
}
