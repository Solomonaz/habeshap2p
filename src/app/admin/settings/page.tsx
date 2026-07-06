import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import {
  isLivePaymentsEnabled,
  getPlatformFee,
  getTradePolicy,
  getOrderTtlMinutes,
  getReleaseWindowMinutes,
  getWithdrawalFee,
  getSellerFeeBps,
  getInternalTransferFee,
  getReferralBps,
  getReferralMaxTrades,
  getSweepStrategy,
  getPooledDepositAddress,
} from "@/lib/settings";
import { fetchHotWalletEnergy } from "@/lib/chain";
import { isTronConfigured } from "@/lib/env";
import { PaymentsModeToggle } from "./payments-mode-toggle";
import { FeeSettingForm } from "./fee-setting-form";
import { TradePolicyForm } from "./trade-policy-form";
import { OrderWindowForm } from "./order-window-form";
import { ReleaseWindowForm } from "./release-window-form";
import { WithdrawalFeeForm } from "./withdrawal-fee-form";
import { TransferFeeForm } from "./transfer-fee-form";
import { ReferralForm } from "./referral-form";
import { SweepStrategyForm } from "./sweep-strategy-form";
import { EnergyStakeForm } from "./energy-stake-form";
import { SettingsWorkspace, type SettingsSection } from "./settings-workspace";

export const dynamic = "force-dynamic";

// Inline stroke icons for the section rail — no icon dependency in this repo.
const ico = "h-[18px] w-[18px]";
const IconPayments = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={ico}>
    <rect x="2" y="8" width="20" height="8" rx="4" />
    <circle cx="16" cy="12" r="2.4" />
  </svg>
);
const IconFees = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={ico}>
    <line x1="19" y1="5" x2="5" y2="19" />
    <circle cx="6.5" cy="6.5" r="2.5" />
    <circle cx="17.5" cy="17.5" r="2.5" />
  </svg>
);
const IconTiming = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={ico}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const IconWallet = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={ico}>
    <path d="M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1" />
    <path d="M3 8v9a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-3" />
    <path d="M21 11v4h-4a2 2 0 0 1 0-4h4z" />
  </svg>
);

export default async function AdminSettingsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  const [
    live,
    configured,
    fee,
    tradePolicy,
    orderTtl,
    releaseWindow,
    withdrawalFee,
    sellerFeeBps,
    transferFee,
    referralBps,
    referralMaxTrades,
    sweepStrategy,
    pooledAddress,
    hotEnergy,
  ] = await Promise.all([
    isLivePaymentsEnabled(),
    Promise.resolve(isTronConfigured()),
    getPlatformFee(),
    getTradePolicy(),
    getOrderTtlMinutes(),
    getReleaseWindowMinutes(),
    getWithdrawalFee(),
    getSellerFeeBps(),
    getInternalTransferFee(),
    getReferralBps(),
    getReferralMaxTrades(),
    getSweepStrategy(),
    getPooledDepositAddress(),
    fetchHotWalletEnergy(),
  ]);

  // Stored as basis points; the admin works in percent (100 bps = 1%). Exact
  // integer→decimal so e.g. 25 bps renders as "0.25", 100 as "1".
  const bpsToPercent = (bps: number) => {
    const whole = Math.trunc(bps / 100);
    const frac = bps % 100;
    if (frac === 0) return String(whole);
    return `${whole}.${String(frac).padStart(2, "0").replace(/0+$/, "")}`;
  };
  const feePercent = bpsToPercent(fee.bps);
  const sellerPercent = bpsToPercent(sellerFeeBps);
  const referralPercent = bpsToPercent(referralBps);

  const sections: SettingsSection[] = [
    {
      id: "payments",
      label: "Payments",
      hint: "Live vs. test money mode",
      icon: IconPayments,
      content: <PaymentsModeToggle live={live} configured={configured} />,
    },
    {
      id: "fees",
      label: "Fees",
      hint: "Trade, withdrawal & transfer fees",
      icon: IconFees,
      content: (
        <>
          <FeeSettingForm
            percent={feePercent}
            sellerPercent={sellerPercent}
            min={fee.min}
            max={fee.max}
          />
          <ReferralForm
            percent={referralPercent}
            maxTrades={referralMaxTrades}
          />
          <div className="grid gap-5 lg:grid-cols-2">
            <WithdrawalFeeForm fee={withdrawalFee} />
            <TransferFeeForm fee={transferFee} />
          </div>
        </>
      ),
    },
    {
      id: "timing",
      label: "Trade timing",
      hint: "Policy & payment/release windows",
      icon: IconTiming,
      content: (
        <>
          <TradePolicyForm policy={tradePolicy} />
          <div className="grid gap-5 lg:grid-cols-2">
            <OrderWindowForm minutes={orderTtl} />
            <ReleaseWindowForm minutes={releaseWindow} />
          </div>
        </>
      ),
    },
    {
      id: "wallet",
      label: "Wallet & gas",
      hint: "Deposit sweep & Energy",
      icon: IconWallet,
      content: (
        <>
          <SweepStrategyForm
            current={sweepStrategy}
            pooledAddress={pooledAddress}
          />
          {sweepStrategy === "staking" && (
            <EnergyStakeForm
              energy={hotEnergy.energy}
              live={hotEnergy.live}
              error={hotEnergy.error}
            />
          )}
        </>
      ),
    },
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-bold tracking-tight text-ink">Settings</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Platform-wide controls. Changes here are audited.
      </p>

      <SettingsWorkspace sections={sections} />
    </main>
  );
}
