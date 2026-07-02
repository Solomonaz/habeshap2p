import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { computeHealthReport, type CheckStatus } from "@/lib/monitor";
import { formatUsdt } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Launch pre-flight: a live green/amber/red readout of every money-system
 * condition (network, wallet config, gas, solvency, stuck withdrawals, unmatched
 * deposits, cron heartbeats). The same report the monitoring cron alerts on — so
 * an admin can confirm everything is green BEFORE flipping live payments on.
 */
export default async function PreflightPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  const report = await computeHealthReport();
  const blocking = report.failCount;

  const banner =
    blocking > 0
      ? {
          cls: "border-sell/40 bg-sell-wash text-state-disputed",
          title: `${blocking} blocking issue${blocking === 1 ? "" : "s"} — not safe to go live`,
          sub: "Resolve every red item below before turning live payments on.",
        }
      : report.warnCount > 0
        ? {
            cls: "border-amber/40 bg-amber-wash text-amber",
            title: `No blockers · ${report.warnCount} warning${report.warnCount === 1 ? "" : "s"}`,
            sub: "Safe to proceed, but review the amber items.",
          }
        : {
            cls: "border-buy/40 bg-buy-wash text-buy",
            title: "All clear",
            sub: "Every check is green.",
          };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-bold tracking-tight text-ink">
        Launch pre-flight
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Live health of the money system. This is the same report the monitor
        cron pages you on. Reload to re-run every check.
      </p>

      <div className={`mt-5 rounded-card border px-4 py-3.5 ${banner.cls}`}>
        <p className="text-sm font-semibold">{banner.title}</p>
        <p className="mt-0.5 text-xs opacity-90">{banner.sub}</p>
      </div>

      {/* Money summary */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric
          label="Owed to users"
          value={`${formatUsdt(report.liabilitiesUsdt)} USDT`}
        />
        <Metric
          label="On-chain reserve"
          value={
            report.assetsUsdt !== null
              ? `${formatUsdt(report.assetsUsdt)} USDT`
              : report.live
                ? "unreadable"
                : "test mode"
          }
        />
        <Metric
          label="Gas (TRX)"
          value={report.trx !== null ? `${report.trx} TRX` : report.live ? "unreadable" : "test mode"}
        />
      </div>

      <ul className="mt-6 space-y-2">
        {report.checks.map((c) => (
          <li
            key={c.key}
            className="flex items-start gap-3 rounded-card border border-paper-border bg-paper-raised px-4 py-3"
          >
            <StatusDot status={c.status} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <span className="text-sm font-medium text-ink">{c.label}</span>
                {c.href && (
                  <Link
                    href={c.href}
                    className="text-xs text-ink-faint hover:text-ink"
                  >
                    Open →
                  </Link>
                )}
              </div>
              <p className="mt-0.5 text-xs text-ink-muted">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-xs text-ink-faint">
        Reserve vs. liabilities assumes deposits land in the hot wallet (pooled
        strategy). On a per-user sweep strategy, add un-swept deposit-address
        balances to the reserve. Gas thresholds: keep ≥ 100 TRX.
      </p>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-paper-border bg-paper-sunken px-4 py-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 font-amount text-lg text-ink">{value}</p>
    </div>
  );
}

function StatusDot({ status }: { status: CheckStatus }) {
  const map: Record<CheckStatus, { cls: string; glyph: string }> = {
    ok: { cls: "bg-buy-wash text-buy", glyph: "✓" },
    warn: { cls: "bg-amber-wash text-amber", glyph: "!" },
    fail: { cls: "bg-sell-wash text-state-disputed", glyph: "✕" },
    info: { cls: "bg-paper-sunken text-ink-muted", glyph: "•" },
  };
  const s = map[status];
  return (
    <span
      className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.cls}`}
      aria-label={status}
    >
      {s.glyph}
    </span>
  );
}
