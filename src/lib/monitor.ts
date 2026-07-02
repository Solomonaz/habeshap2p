import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { isLivePaymentsEnabled, getSweepStrategy } from "@/lib/settings";
import { isTronConfigured } from "@/lib/env";
import { fetchHotWalletReserve } from "@/lib/chain";
import { TRON_NETWORK, IS_TRON_MAINNET } from "@/lib/chain/config";
import { toMicros, formatUsdt } from "@/lib/money";
import { notifyAdmins } from "@/lib/notifications";

/**
 * Launch + runtime health for the money system. One `computeHealthReport()` powers
 * both the admin pre-flight page (render each check green/amber/red) and the
 * monitoring cron (page admins when something turns red). Never throws — every
 * risky read degrades to a warn so the report always renders.
 */

export type CheckStatus = "ok" | "warn" | "fail" | "info";

export type HealthCheck = {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  href?: string;
};

export type HealthReport = {
  live: boolean;
  mainnet: boolean;
  configured: boolean;
  strategy: string;
  assetsUsdt: string | null; // on-chain hot-wallet USDT
  trx: string | null; // on-chain hot-wallet TRX (gas)
  liabilitiesUsdt: string; // total USDT owed to users
  checks: HealthCheck[];
  failCount: number;
  warnCount: number;
};

// Liquid-TRX (gas) thresholds. Below MIN, withdrawals risk failing for gas.
const GAS_OK = 100;
const GAS_MIN = 20;
// A cron is "stale" (assumed dead) if it hasn't stamped a run in this long.
const STALE_MINUTES = 30;

const EXPECTED_CRONS: { name: string; label: string }[] = [
  { name: "poll-deposits", label: "Deposits poller" },
  { name: "process-withdrawals", label: "Withdrawal signer" },
  { name: "sweep-deposits", label: "Deposit sweeper" },
  { name: "expire-orders", label: "Order expiry / freeze" },
  { name: "monitor", label: "Monitor" },
];

type Admin = SupabaseClient<Database>;

async function countRows(
  admin: Admin,
  table: "withdrawals" | "unmatched_deposits" | "orders",
  col: string,
  val: string,
): Promise<number> {
  const { count } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(col, val);
  return count ?? 0;
}

function ageLabel(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Record that a background job just ran (best-effort; never throws). */
export async function recordCronRun(name: string, ok: boolean): Promise<void> {
  try {
    const admin = createAdminSupabase();
    await admin.rpc("record_cron_run", { p_name: name, p_ok: ok });
  } catch {
    /* heartbeat is best-effort */
  }
}

export async function computeHealthReport(): Promise<HealthReport> {
  const admin = createAdminSupabase();

  const [live, strategy, reserveInfo, liab] = await Promise.all([
    isLivePaymentsEnabled(),
    getSweepStrategy(),
    fetchHotWalletReserve(),
    admin.rpc("platform_liabilities_usdt"),
  ]);
  const configured = (() => {
    try {
      return isTronConfigured();
    } catch {
      return false;
    }
  })();

  const [stuck, pendingApproval, unmatched, disputed] = await Promise.all([
    countRows(admin, "withdrawals", "status", "SENDING"),
    countRows(admin, "withdrawals", "status", "PENDING_APPROVAL"),
    countRows(admin, "unmatched_deposits", "status", "PENDING"),
    countRows(admin, "orders", "state", "DISPUTED"),
  ]);

  const { data: hbRows } = await admin
    .from("cron_heartbeats")
    .select("name, last_run_at, last_ok");
  const heartbeats = new Map(
    (hbRows ?? []).map((r) => [r.name, r]),
  );

  const liabilitiesUsdt =
    typeof liab.data === "string" && liab.data ? liab.data : "0";
  const reserve = reserveInfo.reserve;
  const assetsUsdt = reserve?.usdt ?? null;
  const trx = reserve?.trx ?? null;

  const checks: HealthCheck[] = [];

  // Payments mode
  checks.push({
    key: "mode",
    label: "Payments mode",
    status: "info",
    detail: live ? "LIVE — real money is ON" : "TEST mode — no real money",
    href: "/admin/settings",
  });

  // Network
  checks.push({
    key: "network",
    label: "Chain network",
    status: IS_TRON_MAINNET ? "ok" : live ? "fail" : "warn",
    detail: IS_TRON_MAINNET
      ? "Tron mainnet"
      : `${TRON_NETWORK} (testnet)` +
        (live
          ? " — LIVE payments on a TESTNET"
          : " — set NEXT_PUBLIC_TRON_NETWORK=mainnet before launch"),
  });

  // Provider secrets
  checks.push({
    key: "provider",
    label: "Wallet & provider config",
    status: configured ? "ok" : live ? "fail" : "warn",
    detail: configured
      ? "API key + hot wallet + deposit mnemonic are set"
      : "Missing Tron secrets (TRON_API_KEY, HOT_WALLET_ADDRESS/PRIVATE_KEY, DEPOSIT_MNEMONIC)",
  });

  // Gas (liquid TRX)
  if (!live) {
    checks.push({
      key: "gas",
      label: "Hot-wallet gas (TRX)",
      status: "info",
      detail: "Not checked in test mode",
    });
  } else if (reserveInfo.error || trx === null) {
    checks.push({
      key: "gas",
      label: "Hot-wallet gas (TRX)",
      status: "warn",
      detail: `Couldn't read the hot wallet${reserveInfo.error ? `: ${reserveInfo.error}` : ""}`,
    });
  } else {
    const n = Number(trx);
    checks.push({
      key: "gas",
      label: "Hot-wallet gas (TRX)",
      status: n >= GAS_OK ? "ok" : n >= GAS_MIN ? "warn" : "fail",
      detail:
        `${trx} TRX available` +
        (n < GAS_OK
          ? ` — top up (withdrawals burn gas; keep ≥ ${GAS_OK} TRX)`
          : ""),
    });
  }

  // Solvency: on-chain USDT vs what we owe users
  if (!live) {
    checks.push({
      key: "solvency",
      label: "Reserves cover liabilities",
      status: "info",
      detail: `Owed to users: ${formatUsdt(liabilitiesUsdt)} USDT (on-chain check skipped in test mode)`,
    });
  } else if (reserveInfo.error || assetsUsdt === null) {
    checks.push({
      key: "solvency",
      label: "Reserves cover liabilities",
      status: "warn",
      detail: "Couldn't read the on-chain hot-wallet balance",
    });
  } else {
    const assets = toMicros(assetsUsdt);
    const owed = toMicros(liabilitiesUsdt);
    checks.push({
      key: "solvency",
      label: "Reserves cover liabilities",
      status: assets >= owed ? "ok" : "fail",
      detail:
        `On-chain ${formatUsdt(assetsUsdt)} vs owed ${formatUsdt(liabilitiesUsdt)} USDT` +
        (assets < owed ? " — SHORTFALL" : "") +
        (strategy !== "pooled"
          ? " (excludes un-swept per-user deposits)"
          : ""),
      href: "/admin/overview",
    });
  }

  // Stuck withdrawals
  checks.push({
    key: "stuck",
    label: "Stuck withdrawals",
    status: stuck === 0 ? "ok" : "fail",
    detail:
      stuck === 0
        ? "None parked in SENDING"
        : `${stuck} withdrawal(s) stuck in SENDING — reconcile by hand`,
    href: "/admin/withdrawals",
  });

  // Unmatched deposits
  checks.push({
    key: "unmatched",
    label: "Unmatched deposits",
    status: unmatched === 0 ? "ok" : "warn",
    detail:
      unmatched === 0
        ? "None pending"
        : `${unmatched} deposit(s) matched no intent — credit or ignore`,
    href: "/admin/unmatched",
  });

  // Pending approvals (informational)
  checks.push({
    key: "approvals",
    label: "Withdrawals awaiting approval",
    status: "info",
    detail: `${pendingApproval} pending`,
    href: "/admin/withdrawals",
  });

  // Open disputes (informational)
  checks.push({
    key: "disputes",
    label: "Open disputes",
    status: "info",
    detail: `${disputed} in dispute`,
    href: "/admin",
  });

  // Cron heartbeats
  for (const c of EXPECTED_CRONS) {
    const hb = heartbeats.get(c.name);
    if (!hb) {
      checks.push({
        key: `cron:${c.name}`,
        label: `Cron · ${c.label}`,
        status: "warn",
        detail: "Never run — is this job scheduled on cron-job.org?",
      });
      continue;
    }
    const stale =
      Date.now() - new Date(hb.last_run_at).getTime() > STALE_MINUTES * 60000;
    checks.push({
      key: `cron:${c.name}`,
      label: `Cron · ${c.label}`,
      status: stale ? "fail" : hb.last_ok ? "ok" : "warn",
      detail:
        `Last run ${ageLabel(hb.last_run_at)}` +
        (stale ? ` — stale (> ${STALE_MINUTES}m)` : "") +
        (!hb.last_ok ? " — last run errored" : ""),
    });
  }

  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;

  return {
    live,
    mainnet: IS_TRON_MAINNET,
    configured,
    strategy,
    assetsUsdt,
    trx,
    liabilitiesUsdt,
    checks,
    failCount,
    warnCount,
  };
}

/** Has an admin already been alerted for `type` within the cooldown window? */
async function alertedRecently(
  admin: Admin,
  type: string,
  cooldownHours: number,
): Promise<boolean> {
  const cutoff = new Date(
    Date.now() - cooldownHours * 3600_000,
  ).toISOString();
  const { data } = await admin
    .from("notifications")
    .select("id", { head: false })
    .eq("audience", "admin")
    .eq("type", type)
    .gt("created_at", cutoff)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * Compute the report and page admins for anything red (and a few actionable
 * ambers). Per-alert throttled so a persistent problem doesn't spam every run.
 * Called by the monitoring cron. Returns a small summary for the cron response.
 */
export async function runMonitorAlerts(): Promise<{
  fails: number;
  warns: number;
  alerted: string[];
}> {
  const admin = createAdminSupabase();
  const report = await computeHealthReport();
  const alerted: string[] = [];

  // Which checks should page an admin, and how urgently.
  const alertable = report.checks.filter(
    (c) =>
      c.status === "fail" ||
      (c.status === "warn" && (c.key === "gas" || c.key === "unmatched")),
  );

  for (const c of alertable) {
    const type = `alert_${c.key.replace(/[^a-z0-9]+/gi, "_")}`;
    // Critical money issues re-alert every 3h; others every 12h.
    const cooldown =
      c.key === "solvency" || c.key === "stuck" || c.key === "gas" ? 3 : 12;
    if (await alertedRecently(admin, type, cooldown)) continue;
    await notifyAdmins({
      type,
      title:
        c.status === "fail"
          ? `⚠ ${c.label}`
          : `Heads up: ${c.label}`,
      body: c.detail,
      href: c.href ?? "/admin/preflight",
    });
    alerted.push(c.key);
  }

  return { fails: report.failCount, warns: report.warnCount, alerted };
}
