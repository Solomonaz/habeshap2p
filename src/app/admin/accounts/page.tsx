import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { fetchModeratedAccounts } from "@/lib/accounts";
import { traderHandle } from "@/lib/handle";
import { ReinstateAccount } from "./reinstate";

export const dynamic = "force-dynamic";

export default async function AdminAccountsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  const accounts = await fetchModeratedAccounts();
  const frozen = accounts.filter((a) => a.accountStatus === "FROZEN");
  const banned = accounts.filter((a) => a.accountStatus === "BANNED");

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Moderated accounts
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Sellers frozen for missing a release window, and accounts permanently
          banned. Open the case to review the chat and proof. A banned account can
          be reinstated on appeal — that returns the forfeited funds and lets them
          trade again.
        </p>

        <Section
          title="Frozen — awaiting a ruling"
          empty="No frozen accounts."
          accounts={frozen}
        />
        <Section
          title="Banned — reviewable & appealable"
          empty="No banned accounts."
          accounts={banned}
        />
    </main>
  );
}

function Section({
  title,
  empty,
  accounts,
}: {
  title: string;
  empty: string;
  accounts: Awaited<ReturnType<typeof fetchModeratedAccounts>>;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
        {title}
      </h2>
      {accounts.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {accounts.map((a) => {
            const isBanned = a.accountStatus === "BANNED";
            return (
              <li
                key={a.userId}
                className="rounded-card border border-paper-border bg-paper-raised p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">
                      {traderHandle(a.userId)}
                    </span>
                    <span
                      className={
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                        (isBanned
                          ? "bg-sell-wash text-state-disputed"
                          : "bg-paper-sunken text-ink-soft")
                      }
                    >
                      {a.accountStatus}
                    </span>
                  </span>
                  <span className="font-amount text-xs text-ink-faint">
                    {isBanned
                      ? `${a.forfeitedUsdt} USDT forfeited`
                      : `${a.frozenUsdt} USDT frozen`}
                  </span>
                </div>
                {a.banReason && (
                  <p className="mt-1.5 text-xs text-ink-soft">{a.banReason}</p>
                )}
                {a.frozenAt && (
                  <p className="mt-1 text-xs text-ink-faint">
                    Since {new Date(a.frozenAt).toLocaleString()}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {a.disputeId && (
                    <Link
                      href={`/admin/disputes/${a.disputeId}`}
                      className="rounded-md border border-paper-border px-3 py-1.5 text-xs text-ink-soft hover:bg-paper-sunken"
                    >
                      Review case
                    </Link>
                  )}
                  {isBanned && (
                    <ReinstateAccount
                      userId={a.userId}
                      disputeId={a.disputeId ?? undefined}
                      forfeitedUsdt={a.forfeitedUsdt}
                      compact
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
