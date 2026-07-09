import "server-only";
import { createHash } from "node:crypto";
import type { SweepStrategy } from "@/lib/settings";
import type { TronNetwork } from "./config";
import type {
  ChainProvider,
  EnergySnapshot,
  FetchTransfersOptions,
  HotWalletReserve,
  IncomingTransfer,
  SendResult,
  SweepOutcome,
} from "./provider";

/**
 * A no-network, no-keys ChainProvider for building and reviewing Phase 7 without
 * any real funds, hot wallet, or node provider. It:
 *   - derives a deterministic, address-shaped string per user (stable, fake),
 *   - never reports incoming transfers (so the poller is a safe no-op),
 *   - REFUSES to "send" in production (so the stub can never move real money).
 *
 * Swap in the real TronGrid/tronweb provider via getChainProvider once keys are
 * set; the rest of the app does not change.
 */

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A 34-char, 'T'-prefixed, address-shaped string derived from the user id. */
function fakeTronAddress(userId: string): string {
  const digest = createHash("sha256").update(userId).digest();
  let out = "T";
  for (let i = 0; i < 33; i++) {
    out += BASE58[digest[i % digest.length]! % BASE58.length];
  }
  return out;
}

export class StubChainProvider implements ChainProvider {
  constructor(public readonly network: TronNetwork) {}

  async deriveDepositAddress(userId: string): Promise<string> {
    return fakeTronAddress(userId);
  }

  async fetchIncomingTransfers(
    _addresses: string[],
    _opts?: FetchTransfersOptions,
  ): Promise<IncomingTransfer[]> {
    // No real chain to read — the poller credits nothing under the stub.
    return [];
  }

  async sendUsdt(toAddress: string, amountUsdt: string): Promise<SendResult> {
    if (process.env.NODE_ENV === "production") {
      // Hard stop: the stub must never be the thing signing in production. A
      // real withdrawal requires the configured TronGrid/tronweb provider.
      throw new Error(
        "StubChainProvider cannot send USDT in production — configure a real " +
          "chain provider (TRON_HOT_WALLET_PRIVATE_KEY + TRON_API_KEY).",
      );
    }
    // Dev/test: pretend the broadcast succeeded with a deterministic fake hash
    // so the withdrawal state machine can be exercised end-to-end.
    const txHash = createHash("sha256")
      .update(`${toAddress}:${amountUsdt}:${Date.now()}`)
      .digest("hex");
    return { txHash };
  }

  async isConfirmed(_txHash: string): Promise<boolean> {
    // Treat anything broadcast by the stub as immediately confirmed in dev.
    return true;
  }

  async getHotWalletBalances(): Promise<HotWalletReserve> {
    // No real hot wallet under the stub — report zeros so the ops console can
    // render a neutral "test mode" state without special-casing.
    return { address: "(stub — no hot wallet)", trx: "0", usdt: "0" };
  }

  async sweepDepositAddress(
    _userId: string,
    _fromAddress: string,
    _strategy: SweepStrategy,
  ): Promise<SweepOutcome> {
    // No chain to sweep in test mode.
    return { status: "skipped", reason: "test mode" };
  }

  async getHotWalletEnergy(): Promise<EnergySnapshot> {
    // No real hot wallet under the stub — report zeros.
    return { energyLimit: 0, energyUsed: 0, energyAvailable: 0, frozenTrx: "0" };
  }

  async freezeForEnergy(_amountTrx: string): Promise<SendResult> {
    throw new Error(
      "StubChainProvider cannot stake TRX for Energy — configure a real chain provider.",
    );
  }

  async unfreezeEnergy(_amountTrx: string): Promise<SendResult> {
    throw new Error(
      "StubChainProvider cannot unstake Energy — configure a real chain provider.",
    );
  }
}
