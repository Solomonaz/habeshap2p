import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";
import { expireUnpaid, freezeOverdue } from "@/lib/orders";
import { recordCronRun } from "@/lib/monitor";

// This route moves money (returns escrowed USDT to sellers), so it must never
// be statically cached or pre-rendered.
export const dynamic = "force-dynamic";

/**
 * Cron sweep: two passes over overdue orders.
 *   1. CREATED past deadline → auto-cancel, returning locked USDT to the seller
 *      (security rule #4).
 *   2. PAID past the release deadline → freeze the stalling seller's whole wallet,
 *      temp-ban them, and auto-open a dispute for an admin to rule on.
 *
 * AUTH: guarded by a shared secret. The caller must present it as either
 *   Authorization: Bearer <CRON_SECRET>
 * or  ?secret=<CRON_SECRET>
 * (Vercel Cron sends the Authorization header automatically.) Without
 * CRON_SECRET configured the endpoint refuses to run, so it can't be triggered
 * anonymously to probe behaviour.
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

  const cancelled = await expireUnpaid();
  const frozen = await freezeOverdue();
  await recordCronRun("expire-orders", true);
  return NextResponse.json({ ok: true, cancelled, frozen });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
