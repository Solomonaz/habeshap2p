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
import { SweepStrategyForm } from "./sweep-strategy-form";
import { EnergyStakeForm } from "./energy-stake-form";

export const dynamic = "force-dynamic";

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
    getSweepStrategy(),
    getPooledDepositAddress(),
    fetchHotWalletEnergy(),
  ]);

  // Stored as basis points; the admin works in percent (100 bps = 1%). Exact
  // integer→decimal so e.g. 25 bps renders as "0.25", 100 as "1".
  const feePercent = (() => {
    const whole = Math.trunc(fee.bps / 100);
    const frac = fee.bps % 100;
    if (frac === 0) return String(whole);
    return `${whole}.${String(frac).padStart(2, "0").replace(/0+$/, "")}`;
  })();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Platform-wide controls. Changes here are audited.
        </p>

        <PaymentsModeToggle live={live} configured={configured} />
        <SweepStrategyForm current={sweepStrategy} pooledAddress={pooledAddress} />
        {sweepStrategy === "staking" && (
          <EnergyStakeForm
            energy={hotEnergy.energy}
            live={hotEnergy.live}
            error={hotEnergy.error}
          />
        )}
        <FeeSettingForm percent={feePercent} min={fee.min} max={fee.max} />
        <TradePolicyForm policy={tradePolicy} />
        <OrderWindowForm minutes={orderTtl} />
        <ReleaseWindowForm minutes={releaseWindow} />
        <WithdrawalFeeForm fee={withdrawalFee} />
    </main>
  );
}
