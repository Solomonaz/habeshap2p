import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";
import { sweepDeposits } from "@/lib/sweeper";

// Moves on-chain USDT from deposit addresses into the hot wallet, so it must
// never be statically cached or pre-rendered.
export const dynamic = "force-dynamic";

/**
 * Cron sweeper (Phase 7): consolidate USDT received at per-user deposit
 * addresses into the hot wallet, so the hot wallet keeps enough liquidity to pay
 * withdrawals. Each address is gassed first if it lacks the TRX to move its USDT;
 * the actual transfer happens on a later run once the gas confirms.
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

  const result = await sweepDeposits();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
