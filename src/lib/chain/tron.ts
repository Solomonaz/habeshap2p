import "server-only";
import { createHash } from "node:crypto";
import { fromMicros, toMicros } from "@/lib/money";
import type { SweepStrategy } from "@/lib/settings";
import type { TronNetwork } from "./config";
import { DEPOSIT_MIN_CONFIRMATIONS } from "./config";
import type {
  ChainProvider,
  EnergySnapshot,
  HotWalletReserve,
  IncomingTransfer,
  SendResult,
  SweepOutcome,
} from "./provider";
import { EnergyRentalUnavailable, rentEnergy } from "./energy-rental";

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

/**
 * Energy a single TRC-20 USDT transfer consumes. A transfer to an address that
 * already holds USDT costs ~13–30k; to a fresh balance ~65k. We provision for the
 * worst case (with headroom) so a sweep never falls short and burns TRX.
 */
const USDT_TRANSFER_ENERGY = 65_000;
/** Safety headroom on the Energy we delegate/rent per sweep. */
const ENERGY_SAFETY_MULTIPLIER = 1.3;
/** 1 TRX = 1e6 sun. */
const SUN_PER_TRX = 1_000_000n;

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

  /**
   * On-chain TRX + USDT balances of an address as exact decimal strings. TRX is
   * 6-decimal (sun = micro-TRX) and USDT is 6-decimal, so both reuse the money
   * helper.
   *
   * IMPORTANT: USDT is read from CONTRACT STATE (balanceOf), not TronGrid's
   * /v1/accounts indexer. Deposit addresses normally hold 0 TRX (that's why the
   * sweeper gas-tops-them-up), which means they are *unactivated* accounts — and
   * TronGrid's account API returns no record (data: []) for an unactivated
   * address even when it holds TRC-20 tokens. Reading balanceOf directly avoids
   * that blind spot, so the sweeper never skips an address that actually holds
   * USDT. trx.getBalance works for unactivated accounts too (returns 0).
   */
  private async readBalances(address: string): Promise<{
    trx: string;
    usdt: string;
  }> {
    const tronWeb = await this.getSigner();
    const contract = await tronWeb.contract().at(this.usdtContract);
    const rawUsdt = await contract.balanceOf(address).call();
    const usdtMicros = BigInt(rawUsdt.toString());
    const sun = await tronWeb.trx.getBalance(address);
    const trxSun = BigInt(Math.trunc(Number(sun)));
    return { trx: fromMicros(trxSun), usdt: fromMicros(usdtMicros) };
  }

  async getHotWalletBalances(): Promise<HotWalletReserve> {
    const balances = await this.readBalances(this.hotWalletAddress);
    return { address: this.hotWalletAddress, ...balances };
  }

  /**
   * Consolidate one per-user deposit address into the hot wallet WITHOUT burning
   * TRX. Two-phase by design: the first run provisions Energy for the address
   * (delegating it from the hot wallet's stake, or renting it), the next run
   * forwards the USDT once the Energy is live.
   *
   *   staking — delegate Energy from the hot wallet's frozen TRX, sweep, then
   *             reclaim the delegation. TRX is locked, never spent.
   *   rental  — rent Energy from the external market, then sweep (rental expires).
   *   pooled  — no-op: pooled mode has no per-user deposit addresses to sweep.
   *
   * If Energy can't be provisioned (nothing staked, rental down, …) the address is
   * SKIPPED with a reason and the USDT is left for a later run — we never fall back
   * to sending TRX. Never touches the internal ledger (credited at deposit time).
   */
  async sweepDepositAddress(
    userId: string,
    fromAddress: string,
    strategy: SweepStrategy,
  ): Promise<SweepOutcome> {
    if (strategy === "pooled") {
      // Pooled deposits land straight in the hot wallet — nothing to consolidate.
      return { status: "skipped", reason: "pooled mode — no per-user sweep" };
    }

    const { usdt } = await this.readBalances(fromAddress);
    const usdtMicros = toMicros(usdt);
    if (usdtMicros <= 0n) return { status: "skipped", reason: "no USDT" };

    const neededEnergy = Math.ceil(
      USDT_TRANSFER_ENERGY * ENERGY_SAFETY_MULTIPLIER,
    );
    const available = await this.addressEnergyAvailable(fromAddress);

    // Phase 1: provision Energy if the address doesn't have enough yet.
    if (available < neededEnergy) {
      if (strategy === "staking") {
        return this.delegateEnergyForSweep(fromAddress, neededEnergy);
      }
      // strategy === "rental"
      try {
        const { reference } = await rentEnergy(fromAddress, neededEnergy);
        return { status: "rented", txHash: reference };
      } catch (err) {
        if (err instanceof EnergyRentalUnavailable) {
          return { status: "skipped", reason: err.message };
        }
        throw err;
      }
    }

    // Phase 2: the address has Energy — forward its full USDT balance.
    const txHash = await this.transferFromDepositAddress(
      userId,
      fromAddress,
      usdtMicros,
    );

    // Reclaim any Energy delegated to this address so the hot wallet's stake is
    // freed for the next sweep. Done REGARDLESS of the current strategy: if an
    // earlier staking run delegated Energy here and the admin has since switched
    // to 'rental', we must STILL undelegate it now or that stake stays delegated
    // to a throwaway address forever, permanently shrinking the staking pool. The
    // reclaim reads the actual on-chain delegated amount and is a no-op when there
    // is none (the rental path never delegates), so it is always safe to call.
    await this.reclaimDelegatedEnergy(fromAddress);

    return { status: "swept", txHash, amountUsdt: usdt };
  }

  /** Energy currently available to an address (delegated + owned − used). */
  private async addressEnergyAvailable(address: string): Promise<number> {
    const tronWeb = await this.getSigner();
    const res = await tronWeb.trx.getAccountResources(address);
    const limit = Number(res.EnergyLimit ?? 0);
    const used = Number(res.EnergyUsed ?? 0);
    return Math.max(0, limit - used);
  }

  /**
   * Sun of staked TRX to delegate to yield `energy` units, derived from the
   * network ratio (TotalEnergyLimit / TotalEnergyWeight = energy per staked TRX).
   */
  private async sunForEnergy(energy: number): Promise<bigint> {
    const tronWeb = await this.getSigner();
    const res = await tronWeb.trx.getAccountResources(this.hotWalletAddress);
    const totalLimit = Number(res.TotalEnergyLimit ?? 0);
    const totalWeight = Number(res.TotalEnergyWeight ?? 0);
    if (totalLimit <= 0 || totalWeight <= 0) {
      throw new Error("could not read network Energy ratio from TronGrid");
    }
    const energyPerTrx = totalLimit / totalWeight; // energy per 1 TRX staked
    const trx = energy / energyPerTrx;
    return BigInt(Math.ceil(trx)) * SUN_PER_TRX;
  }

  /** Sign + broadcast a transaction the hot-wallet signer just built. */
  private async signAndSend(tx: unknown): Promise<string> {
    const tronWeb = await this.getSigner();
    const signed = await tronWeb.trx.sign(tx);
    const receipt = await tronWeb.trx.sendRawTransaction(signed);

    // CRITICAL: tronweb's sendRawTransaction ALWAYS echoes the signed transaction
    // back (receipt.transaction), and a signed tx always carries a precomputed
    // txID — so a non-empty tx hash does NOT mean the node accepted the broadcast.
    // A rejection comes back with an error `code` (CONTRACT_VALIDATE_ERROR,
    // SIGERROR, TAPOS_ERROR, BANDWIDTH/ENERGY errors, …) and/or result === false.
    // We MUST gate on that, or a rejected freeze / unfreeze / delegate /
    // undelegate would be reported as success with a hash that never lands
    // on-chain — leaving the staking strategy (and the admin's Energy view +
    // audit log) silently wrong. We mirror tronweb's own success criterion
    // (failure iff an error `code` is present) so a genuine success is never
    // false-rejected into a retry that would double-stake TRX; `result === false`
    // is an extra belt for nodes that signal failure that way.
    if (receipt.code || receipt.result === false) {
      const code = receipt.code ? String(receipt.code) : "node rejected the broadcast";
      let detail = "";
      if (receipt.message) {
        // The failure message is hex-encoded; decode it best-effort for the log.
        try {
          detail = `: ${tronWeb.toUtf8?.(receipt.message) ?? receipt.message}`;
        } catch {
          detail = `: ${receipt.message}`;
        }
      }
      throw new Error(`transaction broadcast was not accepted (${code}${detail})`);
    }

    const txHash = receipt.txid ?? receipt.transaction?.txID ?? "";
    if (!txHash) {
      throw new Error("transaction broadcast accepted but returned no tx hash");
    }
    return txHash;
  }

  /**
   * Phase 1 (staking): delegate `energy` units of Energy from the hot wallet's
   * frozen stake to the deposit address. Returns `skipped` (never throws) when the
   * hot wallet has no spare staked Energy — the address waits for the next run.
   */
  private async delegateEnergyForSweep(
    fromAddress: string,
    energy: number,
  ): Promise<SweepOutcome> {
    const hotEnergy = await this.getHotWalletEnergy();
    if (hotEnergy.energyAvailable < energy) {
      return {
        status: "skipped",
        reason:
          `hot wallet has ${hotEnergy.energyAvailable} Energy, needs ${energy} ` +
          `— stake more TRX for Energy to enable staking sweeps`,
      };
    }

    const tronWeb = await this.getSigner();
    const amountSun = await this.sunForEnergy(energy);
    const tx = await tronWeb.transactionBuilder.delegateResource(
      Number(amountSun),
      fromAddress,
      "ENERGY",
      this.hotWalletAddress,
    );
    const txHash = await this.signAndSend(tx);
    if (!txHash) throw new Error("Energy delegation returned no tx hash");
    return { status: "delegated", txHash };
  }

  /**
   * Reclaim Energy delegated to a deposit address back to the hot wallet. Reads
   * the exact amount currently delegated (hot wallet → address) and undelegates
   * just that, so it is strategy-independent and idempotent: it no-ops when
   * nothing is delegated (e.g. the rental path, or an address swept by a different
   * strategy). Best-effort — a failure here is logged but never fails the
   * (already successful) sweep that money-wise has completed.
   */
  private async reclaimDelegatedEnergy(fromAddress: string): Promise<void> {
    try {
      const tronWeb = await this.getSigner();
      const delegated = await tronWeb.trx.getDelegatedResourceV2(
        this.hotWalletAddress,
        fromAddress,
      );
      const amountSun = Number(
        delegated.delegatedResource?.[0]?.frozen_balance_for_energy ?? 0,
      );
      if (amountSun <= 0) return; // nothing delegated (e.g. rental path)
      const tx = await tronWeb.transactionBuilder.undelegateResource(
        amountSun,
        fromAddress,
        "ENERGY",
        this.hotWalletAddress,
      );
      await this.signAndSend(tx);
    } catch (err) {
      console.error(
        `[tron] failed to reclaim delegated Energy from ${fromAddress.slice(
          0,
          6,
        )}…: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Derive the deposit address's key and forward its full USDT to the hot wallet. */
  private async transferFromDepositAddress(
    userId: string,
    fromAddress: string,
    usdtMicros: bigint,
  ): Promise<string> {
    const TronWeb = await this.loadTronWeb();
    const path = `${TRON_DERIVATION_PREFIX}${addressIndex(userId)}`;
    const derived = TronWeb.fromMnemonic(this.depositMnemonic, path);
    if (derived.address !== fromAddress) {
      // The stored address doesn't match what the mnemonic derives for this user
      // — refuse rather than risk signing for the wrong account.
      throw new Error(
        `derived address mismatch for user (expected ${fromAddress})`,
      );
    }

    const depositKey = derived.privateKey.replace(/^0x/, "");
    const Ctor = this.TronWebCtor as TronWebClass;
    const depositWeb = new Ctor({
      fullHost: this.host,
      headers: { "TRON-PRO-API-KEY": this.apiKey },
      privateKey: depositKey,
    });
    const contract = await depositWeb.contract().at(this.usdtContract);
    const txHash: string = await contract
      .transfer(this.hotWalletAddress, usdtMicros.toString())
      .send({ from: fromAddress });
    if (!txHash) throw new Error("sweep transfer returned no tx hash");
    return txHash;
  }

  /** Hot-wallet Energy snapshot (staking strategy + ops console). */
  async getHotWalletEnergy(): Promise<EnergySnapshot> {
    const tronWeb = await this.getSigner();
    const res = await tronWeb.trx.getAccountResources(this.hotWalletAddress);
    const energyLimit = Number(res.EnergyLimit ?? 0);
    const energyUsed = Number(res.EnergyUsed ?? 0);
    // V2 stake for Energy, in sun, summed across the account's frozen entries.
    const account = await tronWeb.trx.getAccount(this.hotWalletAddress);
    const frozenSun = (account.frozenV2 ?? [])
      .filter((f) => f.type === "ENERGY")
      .reduce((sum, f) => sum + BigInt(Math.trunc(Number(f.amount ?? 0))), 0n);
    return {
      energyLimit,
      energyUsed,
      energyAvailable: Math.max(0, energyLimit - energyUsed),
      frozenTrx: fromMicros(frozenSun),
    };
  }

  /** Stake (FreezeBalanceV2) hot-wallet TRX for Energy. */
  async freezeForEnergy(amountTrx: string): Promise<SendResult> {
    const tronWeb = await this.getSigner();
    const amountSun = Number(toMicros(amountTrx));
    if (amountSun <= 0) throw new Error("freeze amount must be positive");
    const tx = await tronWeb.transactionBuilder.freezeBalanceV2(
      amountSun,
      "ENERGY",
      this.hotWalletAddress,
    );
    const txHash = await this.signAndSend(tx);
    if (!txHash) throw new Error("freeze returned no tx hash");
    return { txHash };
  }

  /** Unstake (UnfreezeBalanceV2) hot-wallet Energy stake. */
  async unfreezeEnergy(amountTrx: string): Promise<SendResult> {
    const tronWeb = await this.getSigner();
    const amountSun = Number(toMicros(amountTrx));
    if (amountSun <= 0) throw new Error("unfreeze amount must be positive");
    const tx = await tronWeb.transactionBuilder.unfreezeBalanceV2(
      amountSun,
      "ENERGY",
      this.hotWalletAddress,
    );
    const txHash = await this.signAndSend(tx);
    if (!txHash) throw new Error("unfreeze returned no tx hash");
    return { txHash };
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
      balanceOf: (address: string) => {
        call: () => Promise<{ toString: () => string }>;
      };
    }>;
  };
  trx: {
    getBalance: (address: string) => Promise<number>;
    getAccountResources: (address: string) => Promise<{
      EnergyLimit?: number;
      EnergyUsed?: number;
      TotalEnergyLimit?: number;
      TotalEnergyWeight?: number;
    }>;
    getAccount: (address: string) => Promise<{
      frozenV2?: { type?: string; amount?: number }[];
    }>;
    getDelegatedResourceV2: (
      from: string,
      to: string,
    ) => Promise<{
      delegatedResource?: { frozen_balance_for_energy?: number }[];
    }>;
    sign: (tx: unknown) => Promise<unknown>;
    sendRawTransaction: (signedTx: unknown) => Promise<{
      result?: boolean;
      code?: string;
      message?: string;
      txid?: string;
      transaction?: { txID?: string };
    }>;
  };
  /** Decode a hex-encoded node message (e.g. a broadcast rejection reason). */
  toUtf8?: (hex: string) => string;
  transactionBuilder: {
    delegateResource: (
      amountSun: number,
      receiver: string,
      resource: "ENERGY" | "BANDWIDTH",
      owner: string,
    ) => Promise<unknown>;
    undelegateResource: (
      amountSun: number,
      receiver: string,
      resource: "ENERGY" | "BANDWIDTH",
      owner: string,
    ) => Promise<unknown>;
    freezeBalanceV2: (
      amountSun: number,
      resource: "ENERGY" | "BANDWIDTH",
      owner: string,
    ) => Promise<unknown>;
    unfreezeBalanceV2: (
      amountSun: number,
      resource: "ENERGY" | "BANDWIDTH",
      owner: string,
    ) => Promise<unknown>;
  };
};
type TronWebClass = {
  new (cfg: {
    fullHost: string;
    headers: Record<string, string>;
    privateKey: string;
  }): TronWebInstance;
  fromMnemonic: (
    mnemonic: string,
    path: string,
  ) => { address: string; privateKey: string };
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
