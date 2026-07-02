import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";
import { runMonitorAlerts, recordCronRun } from "@/lib/monitor";

export const dynamic = "force-dynamic";

/**
 * Monitoring worker (launch safety). Computes the money-system health report and
 * pages admins (throttled) for anything red — reserve shortfall, low gas, stuck
 * withdrawals, unmatched deposits, a dead background job. Read-only: it moves no
 * money. Guarded by the shared CRON_SECRET like the other cron routes; schedule it
 * on cron-job.org every ~5–10 minutes.
 */
async function handle(request: NextRequest): Promise<NextResponse> {
  const { CRON_SECRET } = getServerEnv();
  if (!CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }
  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const provided = bearer ?? request.nextUrl.searchParams.get("secret");
  if (provided !== CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runMonitorAlerts();
    await recordCronRun("monitor", true);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    await recordCronRun("monitor", false);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
