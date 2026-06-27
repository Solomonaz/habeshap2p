import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import {
  fetchPendingWithdrawals,
  fetchStuckWithdrawals,
} from "@/lib/withdrawals";
import { formatUsdt } from "@/lib/money";
import { traderHandle } from "@/lib/handle";
import { WithdrawalReview } from "./review";
import { WithdrawalReconcile } from "./reconcile";

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

  const [pending, stuck] = await Promise.all([
    fetchPendingWithdrawals(),
    fetchStuckWithdrawals(),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Withdrawal approvals
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Large withdrawals held for manual sign-off. Approving queues it for the
          signer to broadcast; rejecting refunds the held funds to the user.
        </p>

        {/* In-flight / stuck: a withdrawal the signer claimed but couldn't finish
            recording. The funds may already be on-chain, so it is NEVER auto-retried
            — an admin reconciles each against the explorer before acting. */}
        {stuck.length > 0 && (
          <section className="mt-6 rounded-card border border-state-disputed/40 bg-sell-wash p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-state-disputed">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
              {stuck.length} withdrawal{stuck.length > 1 ? "s" : ""} need manual
              reconciliation
            </h2>
            <p className="mt-1 text-xs text-state-disputed/90">
              The signer claimed these but didn&apos;t finish recording them. Check
              each tx on the explorer: if the USDT left, mark it sent in the DB; if it
              never broadcast, refund it. Do <strong>not</strong> just re-approve —
              that can double-send.
            </p>
            <ul className="mt-3 space-y-2">
              {stuck.map((w) => (
                <li
                  key={w.id}
                  className="rounded-md border border-state-disputed/30 bg-paper-raised px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <span className="font-amount text-sm text-ink">
                      {formatUsdt(w.amount_usdt)} USDT
                    </span>
                    <span className="text-xs text-ink-faint">
                      {traderHandle(w.user_id)} · {new Date(w.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 break-all font-amount text-xs text-ink-faint">
                    → {w.to_address}
                  </p>
                  {w.tx_hash && (
                    <p className="break-all font-amount text-xs text-ink-faint">
                      tx {w.tx_hash}
                    </p>
                  )}
                  <WithdrawalReconcile
                    withdrawalId={w.id}
                    amountUsdt={formatUsdt(w.amount_usdt)}
                    defaultTxHash={w.tx_hash}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

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
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
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
  );
}
