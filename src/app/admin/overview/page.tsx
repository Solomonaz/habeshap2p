import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { fetchPlatformStats, getIncomeBreakdown } from "@/lib/ops";
import { fetchRecentAdminActions } from "@/lib/audit";
import { fetchHotWalletReserve } from "@/lib/chain";
import { summarizeReserves } from "@/lib/platform";
import { formatUsdt, toMicros, fromMicros } from "@/lib/money";
import { traderHandle } from "@/lib/handle";

export const dynamic = "force-dynamic";

/**
 * Ops console (Phase 8): a service-role snapshot of platform balances + open
 * work, the live conservation check, and the admin audit trail. Gated like the
 * rest of /admin — non-admins never see it exists.
 */
export default async function AdminOverviewPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  const [stats, actions, hotWallet, income] = await Promise.all([
    fetchPlatformStats(),
    fetchRecentAdminActions(50),
    fetchHotWalletReserve(),
    getIncomeBreakdown(),
  ]);
  const reserves = summarizeReserves(stats);

  // Withdrawable surplus = on-chain reserve − what you owe users. Only meaningful
  // in live mode (the on-chain float is the real backing).
  const reserveUsdt = hotWallet.live ? hotWallet.reserve?.usdt : null;
  const surplusMicros =
    reserveUsdt != null
      ? toMicros(reserveUsdt) - toMicros(stats.liabilities)
      : null;
  const surplus = surplusMicros != null ? fromMicros(surplusMicros) : null;

  const incomeSources = [
    { label: "Trade fees", value: income.tradeFees, hint: "buyer + seller %" },
    { label: "Withdrawal fees", value: income.withdrawalFees, hint: "per withdrawal" },
    { label: "Transfer fees", value: income.transferFees, hint: "internal sends" },
    {
      label: "Referral payouts",
      value: income.referralPayouts,
      hint: "paid to referrers",
      negative: true,
    },
  ];

  const balanceCards = [
    { label: "Available", value: stats.available },
    { label: "Locked in escrow", value: stats.locked },
    { label: "Merchant bonds", value: stats.bond },
    { label: "Withdrawal holds", value: stats.withdraw_locked },
  ];
  const countCards = [
    { label: "Users", value: stats.user_count },
    { label: "Merchants", value: stats.merchant_count },
    { label: "Active ads", value: stats.active_ad_count },
    { label: "Open orders", value: stats.open_order_count },
    { label: "Open disputes", value: stats.open_dispute_count },
    { label: "Pending withdrawals", value: stats.pending_withdrawal_count },
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Ops overview
        </h1>

        {/* Conservation banner — the headline trust number. */}
        <section
          className={
            "mt-6 rounded-card border p-5 " +
            (reserves.reconciles
              ? "border-paper-border bg-paper-raised"
              : "border-sell/50 bg-sell-wash")
          }
        >
          <p className="text-sm text-ink-muted">
            Total liabilities to users
          </p>
          <p className="mt-1 font-amount text-3xl text-ink">
            {formatUsdt(stats.liabilities)} USDT
          </p>
          <p className="mt-2 text-xs text-ink-faint">
            + {formatUsdt(stats.platform_fees)} USDT platform fees ={" "}
            <span className="font-amount">{formatUsdt(stats.total_supply)}</span>{" "}
            USDT total internal supply, which the on-chain reserve must back.
          </p>
          <p
            className={
              "mt-2 text-xs font-medium " +
              (reserves.reconciles ? "text-state-released" : "text-sell")
            }
          >
            {reserves.reconciles
              ? "✓ Buckets reconcile (recomputed in exact micros)."
              : "⚠ Bucket totals do NOT reconcile — investigate immediately."}
          </p>
        </section>

        {/* Income analysis — where the platform's money is made. */}
        <section className="mt-4 overflow-hidden rounded-card border border-state-released/30 bg-gradient-to-br from-state-released/10 to-paper-raised p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-ink-muted">
                Net income (your earnings)
              </h2>
              <p className="mt-1 font-amount text-3xl text-state-released">
                {formatUsdt(income.net)} USDT
              </p>
              <p className="mt-1 text-xs text-ink-faint">
                All fees collected, minus referral payouts. Held in the platform
                account (not owed to any user).
              </p>
            </div>
            {surplus != null && (
              <div className="rounded-md border border-paper-border bg-paper/60 px-3 py-2 text-right">
                <p className="text-xs text-ink-muted">Withdrawable surplus</p>
                <p
                  className={
                    "mt-0.5 font-amount text-lg " +
                    (Number(surplus) >= 0 ? "text-ink" : "text-sell")
                  }
                >
                  {formatUsdt(surplus)} USDT
                </p>
                <p className="text-[11px] text-ink-faint">reserve − liabilities</p>
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {incomeSources.map((s) => (
              <div
                key={s.label}
                className="rounded-md border border-paper-border bg-paper px-3 py-2.5"
              >
                <p className="text-xs text-ink-muted">{s.label}</p>
                <p
                  className={
                    "mt-0.5 font-amount text-base " +
                    (s.negative ? "text-sell" : "text-ink")
                  }
                >
                  {s.negative ? "−" : ""}
                  {formatUsdt(s.value)}
                </p>
                <p className="text-[11px] text-ink-faint">{s.hint}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Hot-wallet reserve — the on-chain float that backs withdrawals. */}
        <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-ink">Hot wallet reserve</h2>
            {hotWallet.live ? (
              hotWallet.reserve ? (
                <code className="text-xs text-ink-faint">
                  {hotWallet.reserve.address.slice(0, 8)}…
                  {hotWallet.reserve.address.slice(-6)}
                </code>
              ) : null
            ) : (
              <span className="rounded-full bg-paper-sunken px-2 py-0.5 text-xs text-ink-faint">
                test mode
              </span>
            )}
          </div>

          {!hotWallet.live ? (
            <p className="mt-2 text-xs text-ink-muted">
              Live payments are off — no on-chain hot wallet to report. Turn live
              payments on in the admin console to see the real reserve.
            </p>
          ) : hotWallet.error ? (
            <p className="mt-2 text-xs text-sell">
              Couldn’t read the hot wallet: {hotWallet.error}
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-sm text-ink-muted">USDT float</p>
                <p className="mt-1 font-amount text-xl text-ink">
                  {formatUsdt(hotWallet.reserve!.usdt)} USDT
                </p>
              </div>
              <div>
                <p className="text-sm text-ink-muted">TRX for gas</p>
                <p className="mt-1 font-amount text-xl text-ink">
                  {formatUsdt(hotWallet.reserve!.trx)} TRX
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="mt-4 grid gap-3 sm:grid-cols-2">
          {balanceCards.map((c) => (
            <div
              key={c.label}
              className="rounded-card border border-paper-border bg-paper-raised p-4"
            >
              <p className="text-sm text-ink-muted">{c.label}</p>
              <p className="mt-1 font-amount text-xl text-ink">
                {formatUsdt(c.value)} USDT
              </p>
            </div>
          ))}
        </section>

        <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {countCards.map((c) => (
            <div
              key={c.label}
              className="rounded-card border border-paper-border bg-paper-raised p-4 text-center"
            >
              <p className="font-amount text-2xl text-ink">{c.value}</p>
              <p className="mt-1 text-xs text-ink-faint">{c.label}</p>
            </div>
          ))}
        </section>

        <section className="mt-6">
          <h2 className="text-sm font-medium text-ink">Admin activity</h2>
          {actions.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              No admin actions recorded yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {actions.map((a) => (
                <li
                  key={a.id}
                  className="rounded-md border border-paper-border bg-paper px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink">{a.action}</span>
                    <span className="text-xs text-ink-faint">
                      {new Date(a.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {traderHandle(a.admin_id)}
                    {a.target_type && ` · ${a.target_type}`}
                    {a.detail && ` · ${a.detail}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
    </main>
  );
}
