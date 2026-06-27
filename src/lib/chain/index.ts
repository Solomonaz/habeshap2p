import "server-only";
import { getServerEnv } from "@/lib/env";
import { isLivePaymentsEnabled } from "@/lib/settings";
import { TRON_NETWORK } from "./config";
import type {
  ChainProvider,
  EnergySnapshot,
  HotWalletReserve,
} from "./provider";
import { StubChainProvider } from "./stub";
import { TronGridChainProvider } from "./tron";

export type {
  ChainProvider,
  IncomingTransfer,
  SendResult,
  HotWalletReserve,
  EnergySnapshot,
  SweepOutcome,
} from "./provider";
export {
  TRON_NETWORK,
  TRON_NETWORK_LABEL,
  IS_TRON_MAINNET,
  WITHDRAWAL_APPROVAL_THRESHOLD,
  DEPOSIT_MIN_CONFIRMATIONS,
  needsApproval,
} from "./config";

let stubProvider: ChainProvider | null = null;
let tronProvider: ChainProvider | null = null;

/**
 * Resolve the active ChainProvider based on the admin's runtime "live payments"
 * switch (migration 0018):
 *
 *   TEST mode (default)  →  StubChainProvider — no network, no keys, no real
 *                           money. The dev faucet is the only credit path.
 *   LIVE mode            →  TronGridChainProvider — real on-chain deposits and
 *                           withdrawals. Requires the Tron secrets to be set; if
 *                           live is somehow on without them, we FAIL LOUD rather
 *                           than silently fall back to the stub (which would
 *                           leave withdrawals dead).
 *
 * Async because the switch lives in the database. This is the single seam — no
 * caller needs to know which mode is active.
 */
export async function getChainProvider(): Promise<ChainProvider> {
  if (await isLivePaymentsEnabled()) {
    return getLiveProvider();
  }
  return (stubProvider ??= new StubChainProvider(TRON_NETWORK));
}

function getLiveProvider(): ChainProvider {
  const env = getServerEnv();
  if (
    !env.TRON_API_KEY ||
    !env.TRON_HOT_WALLET_ADDRESS ||
    !env.TRON_HOT_WALLET_PRIVATE_KEY ||
    !env.TRON_DEPOSIT_MNEMONIC
  ) {
    throw new Error(
      "Live payments mode is ON but the Tron provider is not configured. Set " +
        "TRON_API_KEY, TRON_HOT_WALLET_ADDRESS, TRON_HOT_WALLET_PRIVATE_KEY and " +
        "TRON_DEPOSIT_MNEMONIC, or turn live payments off in the admin console.",
    );
  }
  return (tronProvider ??= new TronGridChainProvider({
    network: TRON_NETWORK,
    apiKey: env.TRON_API_KEY,
    hotWalletAddress: env.TRON_HOT_WALLET_ADDRESS,
    hotWalletPrivateKey: env.TRON_HOT_WALLET_PRIVATE_KEY,
    depositMnemonic: env.TRON_DEPOSIT_MNEMONIC,
    usdtContract: env.TRON_USDT_CONTRACT,
  }));
}

/**
 * Hot-wallet reserve snapshot for the ops console. Returns the live on-chain TRX
 * + USDT balances when live payments are on, or a neutral "test mode" marker
 * otherwise. Never throws — a TronGrid hiccup surfaces as an error string so the
 * page still renders the rest of the dashboard.
 */
export async function fetchHotWalletReserve(): Promise<{
  live: boolean;
  reserve: HotWalletReserve | null;
  error: string | null;
}> {
  if (!(await isLivePaymentsEnabled())) {
    return { live: false, reserve: null, error: null };
  }
  try {
    const reserve = await getLiveProvider().getHotWalletBalances();
    return { live: true, reserve, error: null };
  } catch (err) {
    return {
      live: true,
      reserve: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Hot-wallet Energy snapshot for the admin staking controls. Like
 * fetchHotWalletReserve: live on-chain Energy when live payments are on, or a
 * neutral "test mode" marker otherwise. Never throws.
 */
export async function fetchHotWalletEnergy(): Promise<{
  live: boolean;
  energy: EnergySnapshot | null;
  error: string | null;
}> {
  if (!(await isLivePaymentsEnabled())) {
    return { live: false, energy: null, error: null };
  }
  try {
    const energy = await getLiveProvider().getHotWalletEnergy();
    return { live: true, energy, error: null };
  } catch (err) {
    return {
      live: true,
      energy: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
