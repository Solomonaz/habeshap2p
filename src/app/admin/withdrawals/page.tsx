import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { fetchPendingWithdrawals } from "@/lib/withdrawals";
import { formatUsdt } from "@/lib/money";
import { traderHandle } from "@/lib/handle";
import { SiteHeader } from "@/components/site-header";
import { WithdrawalReview } from "./review";

export const dynamic = "force-dynamic";

/**
 * Admin approval queue for withdrawals at or above the threshold (rule #6).
 * Non-admins are bounced before they can learn the route exists; the server
 * action and SQL re-check is_admin on every approve/reject.
 */
export default async function AdminWithdrawalsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  const pending = await fetchPendingWithdrawals();

  return (
    <>
      <SiteHeader phone={user.phone} active="admin" userId={user.id} isAdmin />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-xl font-semibold text-ink">Withdrawal approvals</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Large withdrawals held for manual sign-off. Approving queues it for the
          signer to broadcast; rejecting refunds the held funds to the user.
        </p>

        {pending.length === 0 ? (
          <p className="mt-8 text-sm text-ink-muted">
            No withdrawals awaiting approval.
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {pending.map((w) => (
              <li
                key={w.id}
                className="rounded-card border border-paper-border bg-paper-raised px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-amount text-sm text-ink">
                    {formatUsdt(w.amount_usdt)} USDT
                  </span>
                  <span className="text-xs text-ink-faint">
                    {traderHandle(w.user_id)} · requested{" "}
                    {new Date(w.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 break-all font-amount text-xs text-ink-faint">
                  → {w.to_address}
                </p>
                <WithdrawalReview
                  withdrawalId={w.id}
                  amountUsdt={formatUsdt(w.amount_usdt)}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
