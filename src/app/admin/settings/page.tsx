import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import {
  isLivePaymentsEnabled,
  getPlatformFee,
  getTradePolicy,
  getOrderTtlMinutes,
} from "@/lib/settings";
import { isTronConfigured } from "@/lib/env";
import { SiteHeader } from "@/components/site-header";
import { accountLabel } from "@/lib/identity";
import { PaymentsModeToggle } from "./payments-mode-toggle";
import { FeeSettingForm } from "./fee-setting-form";
import { TradePolicyForm } from "./trade-policy-form";
import { OrderWindowForm } from "./order-window-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  const [live, configured, fee, tradePolicy, orderTtl] = await Promise.all([
    isLivePaymentsEnabled(),
    Promise.resolve(isTronConfigured()),
    getPlatformFee(),
    getTradePolicy(),
    getOrderTtlMinutes(),
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
    <>
      <SiteHeader
        account={accountLabel(user)}
        active="admin"
        userId={user.id}
        isAdmin
      />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-ink">Settings</h1>
          <nav className="flex gap-2">
            <Link
              href="/admin"
              className="rounded-md border border-paper-border px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              Disputes
            </Link>
            <Link
              href="/admin/overview"
              className="rounded-md border border-paper-border px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              Ops overview
            </Link>
            <Link
              href="/admin/withdrawals"
              className="rounded-md border border-paper-border px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              Withdrawal approvals
            </Link>
          </nav>
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Platform-wide controls. Changes here are audited.
        </p>

        <PaymentsModeToggle live={live} configured={configured} />
        <FeeSettingForm percent={feePercent} min={fee.min} max={fee.max} />
        <TradePolicyForm policy={tradePolicy} />
        <OrderWindowForm minutes={orderTtl} />
      </main>
    </>
  );
}
