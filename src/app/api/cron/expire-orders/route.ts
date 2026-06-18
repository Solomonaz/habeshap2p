import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";
import { expireUnpaid } from "@/lib/orders";

// This route moves money (returns escrowed USDT to sellers), so it must never
// be statically cached or pre-rendered.
export const dynamic = "force-dynamic";

/**
 * Cron sweep: auto-cancels CREATED orders past their payment deadline and
 * returns the locked USDT to the seller (security rule #4).
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
  return NextResponse.json({ ok: true, cancelled });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
