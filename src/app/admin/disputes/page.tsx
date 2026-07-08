import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { fetchDisputesForAdmin } from "@/lib/disputes";
import { fetchPlatformStats } from "@/lib/ops";
import { StatTile } from "@/components/admin/stat-tile";
import { formatUsdt } from "@/lib/money";
import { formatEtb } from "@/lib/format";
import { traderHandle } from "@/lib/handle";

export const dynamic = "force-dynamic";

const I = (p: React.ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {p}
  </svg>
);

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Defence in depth — the layout already gated, but never trust that alone.
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  // The queue defaults to open cases; ?show=resolved is the permanent history.
  const showResolved = (await searchParams).show === "resolved";
  const [disputes, stats] = await Promise.all([
    fetchDisputesForAdmin({ resolved: showResolved }),
    fetchPlatformStats(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Platform health and the disputes that need a human ruling.
          </p>
        </div>
      </div>

      {/* Metric tiles */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label="Open disputes"
          value={stats.open_dispute_count}
          tone={stats.open_dispute_count > 0 ? "sell" : "neutral"}
          hint={stats.open_dispute_count > 0 ? "Needs a ruling" : "All clear"}
          icon={I(<><path d="M3 21h18" /><path d="M12 3v18M5 8l7-4 7 4" /><path d="M5 8l-2 5a3 3 0 0 0 6 0L7 8" /><path d="M17 8l-2 5a3 3 0 0 0 6 0l-2-5" /></>)}
        />
        <StatTile
          label="Pending withdrawals"
          value={stats.pending_withdrawal_count}
          tone={stats.pending_withdrawal_count > 0 ? "amber" : "neutral"}
          hint="Awaiting approval"
          href="/admin/withdrawals"
          icon={I(<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>)}
        />
        <StatTile
          label="Open orders"
          value={stats.open_order_count}
          icon={I(<><path d="M4 7h16M4 12h16M4 17h10" /></>)}
        />
        <StatTile
          label="Users"
          value={stats.user_count}
          hint={`${stats.merchant_count} merchants`}
          icon={I(<><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 6a3 3 0 0 1 0 6" /></>)}
        />
      </section>

      {/* Dispute queue */}
      <section className="mt-9">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">Dispute queue</h2>
          <div className="inline-flex rounded-lg border border-paper-border bg-paper-raised p-0.5 text-sm">
            <Link
              href="/admin/disputes"
              className={
                "rounded-md px-3 py-1 transition-colors " +
                (!showResolved
                  ? "bg-ink text-paper-raised"
                  : "text-ink-muted hover:text-ink")
              }
            >
              Open
            </Link>
            <Link
              href="/admin/disputes?show=resolved"
              className={
                "rounded-md px-3 py-1 transition-colors " +
                (showResolved
                  ? "bg-ink text-paper-raised"
                  : "text-ink-muted hover:text-ink")
              }
            >
              Resolved history
            </Link>
          </div>
        </div>

        {showResolved ? (
          <p className="mt-1.5 text-sm text-ink-muted">
            The permanent record of every resolved dispute. Open any case to
            re-read the chat and proof. A case that banned a seller can still be
            reinstated here on appeal.
          </p>
        ) : (
          <p className="mt-1.5 text-sm text-ink-muted">
            Review the chat and payment proof, then release the USDT to the buyer
            or return it to the seller. Cases tagged{" "}
            <span className="font-semibold text-state-disputed">
              Seller frozen
            </span>{" "}
            mean a seller missed the release window — check whether the buyer
            actually paid before ruling, as the ruling forfeits funds and bans.
          </p>
        )}

        {disputes.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-paper-border bg-paper-raised/40 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-paper-border bg-paper-sunken/60 text-buy">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
            <p className="text-sm text-ink-muted">
              {showResolved
                ? "No resolved disputes yet."
                : "No open disputes. Nothing needs your attention right now."}
            </p>
          </div>
        ) : (
          <ul className="mt-5 space-y-2.5">
            {disputes.map((d) => {
              const ruled =
                d.resolution === "FAVOUR_BUYER"
                  ? "Released to buyer"
                  : d.resolution === "FAVOUR_SELLER"
                    ? "Returned to seller"
                    : null;
              return (
                <li key={d.id}>
                  <Link
                    href={`/admin/disputes/${d.id}`}
                    className="block rounded-xl border border-state-disputed/25 bg-paper-raised px-4 py-3.5 transition-all duration-150 hover:-translate-y-0.5 hover:border-state-disputed/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="font-amount text-sm text-ink">
                          {formatUsdt(d.order.amount_usdt)} USDT
                        </span>
                        {d.sellerFrozen && (
                          <span className="rounded bg-sell-wash px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-state-disputed">
                            Seller frozen
                          </span>
                        )}
                        {showResolved && ruled && (
                          <span className="rounded bg-paper-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                            {ruled}
                          </span>
                        )}
                      </span>
                      <span className="font-amount text-xs text-ink-faint">
                        {formatEtb(d.order.amount_etb)} ETB
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-soft">
                      {d.reason}
                    </p>
                    <p className="mt-1.5 text-xs text-ink-faint">
                      Buyer {traderHandle(d.order.buyer_id)} · Seller{" "}
                      {traderHandle(d.order.seller_id)} ·{" "}
                      {showResolved && d.resolved_at
                        ? `resolved ${new Date(d.resolved_at).toLocaleString()}`
                        : `opened ${new Date(d.created_at).toLocaleString()}`}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
