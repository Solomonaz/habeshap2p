import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";
import { sweepDeposits } from "@/lib/sweeper";
import { withCronLock } from "@/lib/cron-lock";

// Moves on-chain USDT from deposit addresses into the hot wallet, so it must
// never be statically cached or pre-rendered.
export const dynamic = "force-dynamic";

/**
 * Cron sweeper (Phase 7, Phase 9 strategies): consolidate USDT received at
 * per-user deposit addresses into the hot wallet, so the hot wallet keeps enough
 * liquidity to pay withdrawals. The admin-selected strategy provisions Energy for
 * each address (delegating it from the hot wallet's stake, or renting it) on one
 * run, then forwards the USDT on a later run — never burning TRX. In pooled mode
 * deposits land straight in the hot wallet, so this is a no-op.
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

  // Single-flight: a sweep reads the hot wallet's available Energy and delegates
  // against it, so two overlapping runs could both pass the headroom check and
  // over-commit the stake. The lease lock makes a concurrent invocation a no-op.
  const outcome = await withCronLock("sweep-deposits", () => sweepDeposits(), {
    ttlSeconds: 900,
  });
  if (!outcome.ran) {
    return NextResponse.json({
      ok: true,
      skipped: "another sweep run is already in progress",
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
