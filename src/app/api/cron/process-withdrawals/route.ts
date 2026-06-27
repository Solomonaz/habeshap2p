import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";
import { processApprovedWithdrawals } from "@/lib/withdrawals";
import { withCronLock } from "@/lib/cron-lock";

// This route SIGNS and broadcasts on-chain transfers (burns escrowed USDT), so
// it must never be statically cached or pre-rendered.
export const dynamic = "force-dynamic";

/**
 * Cron signer worker (Phase 7): broadcast every APPROVED withdrawal and advance
 * SENT ones to CONFIRMED. This is the ONLY caller of the chain provider's
 * sendUsdt (security rule #6): it runs server-side, reads the hot-wallet key
 * only from the secret store, and logs every signing attempt without secrets.
 *
 * AUTH: guarded by the shared CRON_SECRET (Bearer header or ?secret=). Because
 * this moves real money it MUST stay reachable only from the secret-guarded
 * cron — never wired to a user-facing action. Without CRON_SECRET set it
 * refuses to run.
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

  // Single-flight hygiene: the per-row claim (migration 0031) is what actually
  // guarantees at-most-once payout, but serializing whole runs avoids needless
  // claim contention and duplicate chain reads when a scheduler double-fires.
  const outcome = await withCronLock(
    "process-withdrawals",
    () => processApprovedWithdrawals(),
    { ttlSeconds: 600 },
  );
  if (!outcome.ran) {
    return NextResponse.json({
      ok: true,
      skipped: "another withdrawal run is already in progress",
    });
  }
  return NextResponse.json({ ok: true, ...outcome.result });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
