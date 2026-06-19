import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { fetchPlatformStats } from "@/lib/ops";
import { fetchRecentAdminActions } from "@/lib/audit";
import { summarizeReserves } from "@/lib/platform";
import { formatUsdt } from "@/lib/money";
import { traderHandle } from "@/lib/handle";
import { SiteHeader } from "@/components/site-header";
import { accountLabel } from "@/lib/identity";

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

  const [stats, actions] = await Promise.all([
    fetchPlatformStats(),
    fetchRecentAdminActions(50),
  ]);
  const reserves = summarizeReserves(stats);

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
    <>
      <SiteHeader account={accountLabel(user)} active="admin" userId={user.id} isAdmin />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-ink">Ops overview</h1>
          <nav className="flex gap-2">
            <Link
              href="/admin"
              className="rounded-md border border-paper-border px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              Disputes
            </Link>
            <Link
              href="/admin/withdrawals"
              className="rounded-md border border-paper-border px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              Withdrawals
            </Link>
          </nav>
        </div>

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
    </>
  );
}
