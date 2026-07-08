import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import {
  fetchModeratedAccounts,
  fetchAccountsPage,
  ACCOUNTS_PAGE_SIZE,
} from "@/lib/accounts";
import { traderHandle } from "@/lib/handle";
import { ReinstateAccount } from "./reinstate";
import { AccountsTable } from "./accounts-table";

export const dynamic = "force-dynamic";

export default async function AdminAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const onlyInactive = sp.status === "inactive";
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ rows, total, pageSize }, moderated] = await Promise.all([
    fetchAccountsPage({ page, query, onlyInactive }),
    fetchModeratedAccounts(),
  ]);
  const frozen = moderated.filter((a) => a.accountStatus === "FROZEN");
  const banned = moderated.filter((a) => a.accountStatus === "BANNED");

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const keep = `${query ? `&q=${encodeURIComponent(query)}` : ""}${
    onlyInactive ? "&status=inactive" : ""
  }`;
  const qs = (p: number) => `?page=${p}${keep}`;
  // Filter pills preserve the active text query but reset to page 1.
  const filterHref = (inactive: boolean) =>
    `?page=1${query ? `&q=${encodeURIComponent(query)}` : ""}${
      inactive ? "&status=inactive" : ""
    }`;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-bold tracking-tight text-ink">Accounts</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Every account. Ban to freeze funds and hide the account from other users
        (nothing is deleted); unban to restore it.
      </p>

      {/* Status filter — all accounts vs registered-but-unconfirmed only. */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <FilterPill href={filterHref(false)} active={!onlyInactive}>
          All accounts
        </FilterPill>
        <FilterPill href={filterHref(true)} active={onlyInactive}>
          Inactive only
        </FilterPill>
      </div>

      {/* Text filter — preserves the active status pill. */}
      <form method="get" className="mt-3 flex items-center gap-2">
        {onlyInactive && <input type="hidden" name="status" value="inactive" />}
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Filter by email, name, or UID"
          className="w-full max-w-sm rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:opacity-90"
        >
          Filter
        </button>
        {query && (
          <Link
            href={filterHref(onlyInactive)}
            className="text-sm text-ink-muted underline hover:text-ink"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="mt-4">
        <AccountsTable rows={rows} />
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between text-sm">
        <p className="text-ink-faint">
          {total === 0
            ? "No accounts"
            : `${(page - 1) * pageSize + 1}–${Math.min(
                page * pageSize,
                total,
              )} of ${total}`}
        </p>
        <div className="flex items-center gap-2">
          <PageLink href={qs(page - 1)} disabled={page <= 1}>
            ← Prev
          </PageLink>
          <span className="text-xs text-ink-faint">
            Page {page} of {pageCount}
          </span>
          <PageLink href={qs(page + 1)} disabled={page >= pageCount}>
            Next →
          </PageLink>
        </div>
      </div>

      <h2 className="mt-12 text-lg font-semibold text-ink">
        Moderated accounts
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Sellers frozen for missing a release window, and accounts banned via the
        forfeit flow. Reinstating a banned account returns the forfeited funds and
        lets them trade again.
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

function FilterPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={
        "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors " +
        (active
          ? "border-transparent bg-ink text-paper"
          : "border-paper-border bg-paper-raised text-ink-soft hover:border-ink/20 hover:text-ink")
      }
    >
      {children}
    </Link>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="cursor-not-allowed rounded-md border border-paper-border px-3 py-1.5 text-xs text-ink-faint opacity-50">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-md border border-paper-border px-3 py-1.5 text-xs text-ink-soft hover:bg-paper-sunken hover:text-ink"
    >
      {children}
    </Link>
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
