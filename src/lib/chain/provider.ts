import type { TronNetwork } from "./config";
import type { SweepStrategy } from "@/lib/settings";

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

/** On-chain balances of an address, as exact decimal strings (never floats). */
export type AccountBalances = {
  /** Native TRX balance (pays for energy/bandwidth). */
  trx: string;
  /** TRC-20 USDT balance. */
  usdt: string;
};

/** Hot-wallet reserve snapshot for the ops console. */
export type HotWalletReserve = AccountBalances & { address: string };

/**
 * Hot-wallet Energy snapshot (migration 0029 — staking strategy). `frozenTrx` is
 * the TRX staked for Energy via FreezeBalanceV2; `energyLimit`/`energyUsed` come
 * from the account's resources. All exact strings / integers — never floats.
 */
export type EnergySnapshot = {
  /** Total Energy the account can draw on (from staked TRX + delegations). */
  energyLimit: number;
  /** Energy already consumed in the current window. */
  energyUsed: number;
  /** Energy currently available (limit − used). */
  energyAvailable: number;
  /** TRX frozen (staked) for Energy, as an exact decimal string. */
  frozenTrx: string;
};

/**
 * Result of attempting to sweep one deposit address into the hot wallet. The new
 * Energy strategies (migration 0029) provision Energy on one run, then forward on
 * the next — so a sweep is a two-phase operation that NEVER burns TRX:
 *   swept     — USDT was forwarded to the hot wallet (txHash + amount).
 *   delegated — staking: Energy was delegated to the address this run; it'll be
 *               swept on a later run once the delegation confirms.
 *   rented    — rental: Energy was rented to the address this run; swept later.
 *   skipped   — nothing to do (no USDT), pooled mode (no per-user sweep), or the
 *               strategy couldn't provision Energy (reason carries why). Funds are
 *               left in place for a later run — we never fall back to burning TRX.
 */
export type SweepOutcome =
  | { status: "swept"; txHash: string; amountUsdt: string }
  | { status: "delegated"; txHash: string }
  | { status: "rented"; txHash?: string }
  // 'burn' strategy: TRX was sent to the deposit address to be burned as Energy on
  // the next run's transfer.
  | { status: "gassed"; txHash: string }
  | { status: "skipped"; reason?: string };

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

  /**
   * Current hot-wallet reserve (TRX for gas + USDT float) for the ops console
   * and low-balance monitoring. Read-only.
   */
  getHotWalletBalances(): Promise<HotWalletReserve>;

  /**
   * Consolidate one per-user deposit address into the hot wallet (the "sweeper").
   * Deposits land at derived addresses but withdrawals pay from the hot wallet,
   * so received USDT must be forwarded there to keep payout liquidity. The
   * `strategy` selects how the outbound transfer's Energy is provisioned:
   *   - staking: delegate Energy from the hot wallet's frozen TRX (two-phase).
   *   - rental:  rent Energy from an external market (two-phase).
   *   - pooled:  no-op (pooled mode has no per-user addresses to sweep).
   * NEVER sends spendable TRX / burns Energy. Never touches the internal ledger —
   * the user was already credited at deposit time.
   */
  sweepDepositAddress(
    userId: string,
    fromAddress: string,
    strategy: SweepStrategy,
  ): Promise<SweepOutcome>;

  /**
   * Hot-wallet Energy snapshot for the ops console + the staking strategy. Read-only.
   */
  getHotWalletEnergy(): Promise<EnergySnapshot>;

  /**
   * Stake (FreezeBalanceV2) `amountTrx` of the hot wallet's TRX for Energy so it
   * can be delegated to deposit addresses. Returns the broadcast tx hash.
   */
  freezeForEnergy(amountTrx: string): Promise<SendResult>;

  /**
   * Unstake (UnfreezeBalanceV2) `amountTrx` of the hot wallet's Energy stake.
   * Returns the broadcast tx hash. (Unfrozen TRX has the network's unlock delay.)
   */
  unfreezeEnergy(amountTrx: string): Promise<SendResult>;
}
