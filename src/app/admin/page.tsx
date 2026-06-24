import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { fetchDisputesForAdmin } from "@/lib/disputes";
import { SiteHeader } from "@/components/site-header";
import { formatUsdt } from "@/lib/money";
import { formatEtb } from "@/lib/format";
import { traderHandle } from "@/lib/handle";
import { accountLabel } from "@/lib/identity";

export const dynamic = "force-dynamic";

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
  // Non-admins must not even learn this route exists.
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  // The queue defaults to open cases; ?show=resolved is the permanent history.
  const showResolved = (await searchParams).show === "resolved";
  const disputes = await fetchDisputesForAdmin({ resolved: showResolved });

  return (
    <>
      <SiteHeader account={accountLabel(user)} active="admin" userId={user.id} isAdmin />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-ink">Dispute queue</h1>
          <nav className="flex flex-wrap gap-2">
            <Link
              href="/admin/accounts"
              className="rounded-md border border-paper-border px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              Accounts
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
            <Link
              href="/admin/kyc"
              className="rounded-md border border-paper-border px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              Verifications
            </Link>
            <Link
              href="/admin/settings"
              className="rounded-md border border-paper-border px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              Settings
            </Link>
          </nav>
        </div>

        {/* Open vs. resolved history toggle. */}
        <div className="mt-4 inline-flex rounded-md border border-paper-border bg-paper-raised p-0.5 text-sm">
          <Link
            href="/admin"
            className={
              "rounded px-3 py-1 " +
              (!showResolved ? "bg-ink text-paper-raised" : "text-ink-muted hover:text-ink")
            }
          >
            Open
          </Link>
          <Link
            href="/admin?show=resolved"
            className={
              "rounded px-3 py-1 " +
              (showResolved ? "bg-ink text-paper-raised" : "text-ink-muted hover:text-ink")
            }
          >
            Resolved history
          </Link>
        </div>
        {showResolved ? (
          <p className="mt-1 text-sm text-ink-muted">
            The permanent record of every resolved dispute. Open any case to
            re-read the chat and proof. A case that banned a seller can still be
            reinstated here on appeal.
          </p>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">
            Frozen orders awaiting a ruling. Review the chat and payment proof,
            then release the USDT to the buyer or return it to the seller. Cases
            tagged{" "}
            <span className="font-semibold text-state-disputed">
              Seller frozen
            </span>{" "}
            mean a seller missed the release window — check whether the buyer
            actually paid before ruling, as the ruling forfeits funds and bans.
          </p>
        )}

        {disputes.length === 0 ? (
          <p className="mt-8 text-sm text-ink-muted">
            {showResolved
              ? "No resolved disputes yet."
              : "No open disputes. Nothing needs your attention right now."}
          </p>
        ) : (
          <ul className="mt-6 space-y-2">
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
                    className="block rounded-card border border-state-disputed/30 bg-paper-raised px-4 py-3 hover:border-state-disputed/60"
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
      </main>
    </>
  );
}
