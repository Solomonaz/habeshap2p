import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * Run `fn` under a named lease lock (migration 0030) so two overlapping cron
 * invocations can't execute the same money / shared-resource worker at once.
 *
 * Claims a lease with a TTL before running; if another run already holds it,
 * returns `{ ran: false }` WITHOUT executing `fn`. The lease auto-expires after
 * `ttlSeconds`, so a crashed run can't wedge the lock forever — pick a TTL
 * comfortably longer than a normal run takes, but short enough that a stuck run
 * frees up within an acceptable window.
 *
 * The lease is always released in a `finally`, even if `fn` throws.
 */
export async function withCronLock<T>(
  name: string,
  fn: () => Promise<T>,
  opts: { ttlSeconds?: number } = {},
): Promise<{ ran: true; result: T } | { ran: false }> {
  const admin = createAdminSupabase();
  const holder = randomUUID();
  const ttlSeconds = opts.ttlSeconds ?? 600;

  const { data: acquired, error } = await admin.rpc("try_acquire_cron_lock", {
    p_name: name,
    p_holder: holder,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) {
    throw new Error(`failed to acquire cron lock '${name}': ${error.message}`);
  }
  if (!acquired) return { ran: false };

  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    const { error: relErr } = await admin.rpc("release_cron_lock", {
      p_name: name,
      p_holder: holder,
    });
    // Non-fatal: the lease expires on its own. Log so a stuck lock is visible.
    if (relErr) {
      console.error(`[cron-lock] failed to release '${name}': ${relErr.message}`);
    }
  }
}
