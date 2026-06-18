import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { fetchDisputesForAdmin } from "@/lib/disputes";
import { SiteHeader } from "@/components/site-header";
import { formatUsdt } from "@/lib/money";
import { formatEtb } from "@/lib/format";
import { traderHandle } from "@/lib/handle";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Non-admins must not even learn this route exists.
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  const disputes = await fetchDisputesForAdmin();

  return (
    <>
      <SiteHeader phone={user.phone} active="admin" userId={user.id} isAdmin />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-ink">Dispute queue</h1>
          <Link
            href="/admin/withdrawals"
            className="rounded-md border border-paper-border px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-sunken"
          >
            Withdrawal approvals
          </Link>
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Frozen orders awaiting a ruling. Review the chat and payment proof,
          then release the USDT to the buyer or return it to the seller.
        </p>

        {disputes.length === 0 ? (
          <p className="mt-8 text-sm text-ink-muted">
            No open disputes. Nothing needs your attention right now.
          </p>
        ) : (
          <ul className="mt-6 space-y-2">
            {disputes.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/admin/disputes/${d.id}`}
                  className="block rounded-card border border-state-disputed/30 bg-paper-raised px-4 py-3 hover:border-state-disputed/60"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-amount text-sm text-ink">
                      {formatUsdt(d.order.amount_usdt)} USDT
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
                    {traderHandle(d.order.seller_id)} · opened{" "}
                    {new Date(d.created_at).toLocaleString()}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
