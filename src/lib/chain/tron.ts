import "server-only";
import { createHash } from "node:crypto";
import { fromMicros, toMicros } from "@/lib/money";
import type { TronNetwork } from "./config";
import { DEPOSIT_MIN_CONFIRMATIONS } from "./config";
import type {
  ChainProvider,
  IncomingTransfer,
  SendResult,
} from "./provider";

/**
 * The REAL Tron (TRC-20 USDT) chain provider — the live counterpart to
 * StubChainProvider. It only ever runs when an admin has turned LIVE payments
 * on AND the secrets are configured (see getChainProvider); in TEST mode the
 * stub is used instead, so this file's code path is dormant by default.
 *
 * Responsibilities, all server-side (rule #6 — keys never leave the server):
 *   - deriveDepositAddress: a stable, unique Tron address per user, HD-derived
 *     from TRON_DEPOSIT_MNEMONIC (BIP-44 path m/44'/195'/0'/0/<index>).
 *   - fetchIncomingTransfers: confirmed inbound USDT to those addresses, read
 *     from TronGrid's TRC-20 transaction API.
 *   - sendUsdt: sign + broadcast a USDT transfer from the hot wallet.
 *   - isConfirmed: confirmation depth check for a broadcast tx.
 *
 * USDT (TRC-20) has 6 decimals — identical to our micro-USDT scale — so an
 * on-chain integer "base unit" value equals our micros exactly. We convert with
 * fromMicros/toMicros and never touch a float.
 *
 * OPERATOR NOTE: deposits land at per-user derived addresses controlled by the
 * mnemonic. Crediting the internal ledger is correct the moment a deposit
 * confirms, but the hot wallet needs on-chain liquidity to satisfy withdrawals —
 * run a sweeper that consolidates received USDT from the derived addresses to
 * the hot wallet. The sweeper is an operational concern, outside this provider.
 */

const TRON_HOST: Record<TronNetwork, string> = {
  mainnet: "https://api.trongrid.io",
  nile: "https://nile.trongrid.io",
  shasta: "https://api.shasta.trongrid.io",
};

/** Mainnet TRC-20 USDT. Testnets use a different contract — set TRON_USDT_CONTRACT. */
const DEFAULT_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

/** BIP-44 coin type for Tron. */
const TRON_DERIVATION_PREFIX = "m/44'/195'/0'/0/";

export type TronProviderConfig = {
  network: TronNetwork;
  apiKey: string;
  hotWalletAddress: string;
  hotWalletPrivateKey: string;
  depositMnemonic: string;
  usdtContract?: string;
};

/**
 * Map a user id to a stable, non-negative BIP-44 address index. Uses the top 31
 * bits of sha256(userId) so it fits a signed 32-bit path component. Collisions
 * are astronomically unlikely at this scale; an operator who needs a hard
 * guarantee can move to an explicit per-user index column.
 */
function addressIndex(userId: string): number {
  const digest = createHash("sha256").update(userId).digest();
  return digest.readUInt32BE(0) & 0x7fffffff;
}

export class TronGridChainProvider implements ChainProvider {
  readonly network: TronNetwork;
  private readonly host: string;
  private readonly apiKey: string;
  private readonly hotWalletAddress: string;
  private readonly hotWalletPrivateKey: string;
  private readonly depositMnemonic: string;
  private readonly usdtContract: string;

  // tronweb is loaded lazily (and only in LIVE mode) so TEST/dev builds don't
  // need the dependency installed. Cached after first construction.
  private signer: unknown | null = null;
  private TronWebCtor: unknown | null = null;

  constructor(cfg: TronProviderConfig) {
    this.network = cfg.network;
    this.host = TRON_HOST[cfg.network];
    this.apiKey = cfg.apiKey;
    this.hotWalletAddress = cfg.hotWalletAddress;
    this.hotWalletPrivateKey = cfg.hotWalletPrivateKey;
    this.depositMnemonic = cfg.depositMnemonic;
    this.usdtContract = cfg.usdtContract ?? DEFAULT_USDT_CONTRACT;
  }

  /** Lazily import tronweb (untyped — the module specifier is hidden from the
   * compiler so the build doesn't require the package until LIVE mode runs). */
  private async loadTronWeb(): Promise<TronWebClass> {
    if (this.TronWebCtor) return this.TronWebCtor as TronWebClass;
    const specifier = "tronweb";
    let mod: Record<string, unknown>;
    try {
      // webpackIgnore: keep this a true runtime import so the bundler never tries
      // to resolve tronweb at build time (it's only present in LIVE deployments).
      mod = (await import(/* webpackIgnore: true */ specifier)) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error(
        "Live payments mode is on but the 'tronweb' package is not installed. " +
          "Run `npm install tronweb` on the server before going live.",
      );
    }
    // tronweb v6 exports { TronWeb }; older versions default-export the class.
    const ctor = (mod.TronWeb ?? mod.default ?? mod) as TronWebClass;
    this.TronWebCtor = ctor;
    return ctor;
  }

  /** A hot-wallet-bound tronweb instance for signing/broadcasting. */
  private async getSigner(): Promise<TronWebInstance> {
    if (this.signer) return this.signer as TronWebInstance;
    const TronWeb = await this.loadTronWeb();
    const instance = new TronWeb({
      fullHost: this.host,
      headers: { "TRON-PRO-API-KEY": this.apiKey },
      privateKey: this.hotWalletPrivateKey,
    });
    this.signer = instance;
    return instance;
  }

  /** Authenticated TronGrid HTTP GET → parsed JSON. */
  private async api<T>(path: string): Promise<T> {
    const res = await fetch(`${this.host}${path}`, {
      headers: { "TRON-PRO-API-KEY": this.apiKey, accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`TronGrid ${path} → HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async deriveDepositAddress(userId: string): Promise<string> {
    const TronWeb = await this.loadTronWeb();
    const path = `${TRON_DERIVATION_PREFIX}${addressIndex(userId)}`;
    const account = TronWeb.fromMnemonic(this.depositMnemonic, path) as {
      address: string;
    };
    if (!account?.address) {
      throw new Error("failed to derive a Tron deposit address");
    }
    return account.address;
  }

  async fetchIncomingTransfers(
    addresses: string[],
  ): Promise<IncomingTransfer[]> {
    const out: IncomingTransfer[] = [];
    const nowBlock = await this.currentBlock();

    for (const address of addresses) {
      // Resilience: a single bad address (e.g. a malformed/legacy address that
      // TronGrid rejects with 4xx, or a transient TronGrid error) must never
      // abort the whole poll — that would stall deposit crediting for everyone.
      // Log it and move on; the next run retries.
      try {
        // Inbound TRC-20 transfers of our USDT contract to this address.
        const resp = await this.api<TronGridTrc20Response>(
          `/v1/accounts/${address}/transactions/trc20` +
            `?only_to=true&limit=50&contract_address=${this.usdtContract}`,
        );
        for (const t of resp.data ?? []) {
          if (!t.transaction_id || !t.value) continue;
          // Only credit transfers past the required confirmation depth. The
          // TRC-20 list doesn't carry block height, so confirm each explicitly.
          const confs = await this.confirmations(t.transaction_id, nowBlock);
          if (confs < DEPOSIT_MIN_CONFIRMATIONS) continue;

          const decimals = t.token_info?.decimals ?? 6;
          out.push({
            txHash: t.transaction_id,
            toAddress: t.to ?? address,
            amountUsdt: baseUnitsToDecimal(t.value, decimals),
          });
        }
      } catch (err) {
        console.error(
          `[tron] skipping deposit address ${address}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return out;
  }

  async sendUsdt(toAddress: string, amountUsdt: string): Promise<SendResult> {
    const tronWeb = await this.getSigner();
    // 6-decimal USDT base units == our micros, exactly.
    const baseUnits = toMicros(amountUsdt).toString();
    const contract = await tronWeb.contract().at(this.usdtContract);
    const txHash: string = await contract
      .transfer(toAddress, baseUnits)
      .send({ from: this.hotWalletAddress });
    if (!txHash) throw new Error("Tron transfer returned no tx hash");
    return { txHash };
  }

  async isConfirmed(txHash: string): Promise<boolean> {
    const confs = await this.confirmations(txHash, await this.currentBlock());
    return confs >= DEPOSIT_MIN_CONFIRMATIONS;
  }

  /** Current head block number. */
  private async currentBlock(): Promise<number> {
    const block = await this.api<TronGridBlock>("/wallet/getnowblock");
    return block.block_header?.raw_data?.number ?? 0;
  }

  /** Confirmation depth of a tx (0 if not yet in a block). */
  private async confirmations(
    txHash: string,
    nowBlock: number,
  ): Promise<number> {
    const info = await this.api<TronGridTxInfo>(
      `/walletsolidity/gettransactioninfobyid?value=${txHash}`,
    ).catch(() => null);
    const blockNumber = info?.blockNumber;
    if (!blockNumber || !nowBlock) return 0;
    return Math.max(0, nowBlock - blockNumber + 1);
  }
}

/** Convert an on-chain integer base-unit string to an exact USDT decimal string. */
function baseUnitsToDecimal(value: string, decimals: number): string {
  // USDT is 6 decimals → base units ARE micros, so reuse the money helper.
  if (decimals === 6) return fromMicros(BigInt(value));
  // General fallback for a non-6-decimal token: scale by hand, exactly.
  const raw = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const intPart = raw / scale;
  const frac = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${intPart}.${frac}` : intPart.toString();
}

// ── Minimal shapes for the untyped tronweb + TronGrid JSON we touch ──────────
type TronWebInstance = {
  contract: () => {
    at: (address: string) => Promise<{
      transfer: (to: string, amount: string) => {
        send: (opts: { from: string }) => Promise<string>;
      };
    }>;
  };
};
type TronWebClass = {
  new (cfg: {
    fullHost: string;
    headers: Record<string, string>;
    privateKey: string;
  }): TronWebInstance;
  fromMnemonic: (mnemonic: string, path: string) => { address: string };
};
type TronGridTrc20Response = {
  data?: {
    transaction_id?: string;
    to?: string;
    value?: string;
    token_info?: { decimals?: number };
  }[];
};
type TronGridBlock = {
  block_header?: { raw_data?: { number?: number } };
};
type TronGridTxInfo = { blockNumber?: number };
