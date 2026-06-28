import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { fetchUnmatchedDeposits } from "@/lib/unmatched";
import { formatUsdt } from "@/lib/money";
import { UnmatchedReconcile } from "./reconcile";

export const dynamic = "force-dynamic";

export default async function AdminUnmatchedPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  const rows = await fetchUnmatchedDeposits();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-bold tracking-tight text-ink">
        Unmatched deposits
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Pooled deposits that arrived with no matching amount — usually because the
        sender rounded the amount, an exchange deducted a fee, or a wallet truncated
        the decimals. The funds are on-chain at the pooled address; credit each to
        the right account (or ignore dust). Crediting is idempotent.
      </p>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-paper-border bg-paper-raised/40 py-14 text-center text-sm text-ink-muted">
          No unmatched deposits. Everything reconciled.
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-amber/30 bg-paper-raised px-4 py-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="font-amount text-base font-semibold text-ink">
                  {formatUsdt(r.amountUsdt)} USDT
                </span>
                <span className="text-xs text-ink-faint">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 break-all font-amount text-xs text-ink-faint">
                tx {r.txHash}
              </p>
              <p className="break-all font-amount text-xs text-ink-faint">
                → {r.toAddress}
              </p>
              {r.suggested && (
                <p className="mt-1.5 text-xs text-ink-soft">
                  Likely{" "}
                  <span className="font-medium text-ink">
                    {r.suggested.email ?? r.suggested.userId.slice(0, 8)}
                  </span>{" "}
                  — they created a{" "}
                  <span className="font-amount">
                    {formatUsdt(r.suggested.intentAmount)}
                  </span>{" "}
                  USDT deposit intent.
                </p>
              )}
              <UnmatchedReconcile
                txHash={r.txHash}
                amountUsdt={formatUsdt(r.amountUsdt)}
                suggested={
                  r.suggested
                    ? { userId: r.suggested.userId, email: r.suggested.email }
                    : null
                }
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
