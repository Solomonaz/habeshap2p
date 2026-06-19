import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { PlatformStats } from "@/lib/platform";

/**
 * Ops snapshot for the admin console (Phase 8). Service-role read — the caller
 * must have already verified the user is an admin. Delegates the aggregation to
 * the `platform_stats` SQL function, which returns every amount as an exact
 * decimal string (no JSON-float rounding in a reconciliation number).
 */
export async function fetchPlatformStats(): Promise<PlatformStats> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("platform_stats");
  if (error) throw new Error(`failed to load platform stats: ${error.message}`);
  if (!data) throw new Error("platform_stats returned no data");
  return data as PlatformStats;
}
