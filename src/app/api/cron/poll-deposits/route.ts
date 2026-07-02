import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";
import { pollDeposits } from "@/lib/deposits";
import { recordCronRun } from "@/lib/monitor";

// Credits user balances from confirmed on-chain deposits, so it must never be
// statically cached or pre-rendered.
export const dynamic = "force-dynamic";

/**
 * Cron poller (Phase 7): scan every assigned deposit address for confirmed
 * inbound USDT and credit the matching user's ledger (idempotent on tx hash).
 *
 * AUTH: guarded by the shared CRON_SECRET, presented as either
 *   Authorization: Bearer <CRON_SECRET>
 * or  ?secret=<CRON_SECRET>
 * Without CRON_SECRET configured the endpoint refuses to run, so it can't be
 * triggered anonymously. Under the stub provider this is a no-op.
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
  const query = request.nextUrl.searchParams.get("secret");
  const provided = bearer ?? query;
  if (provided !== CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await pollDeposits();
  await recordCronRun("poll-deposits", true);
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
