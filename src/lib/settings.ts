import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * Platform runtime settings (Phase 9) — currently just the "live payments"
 * switch the admin flips from the console.
 *
 *   live payments OFF  →  TEST mode: the dev faucet is available and the
 *                         no-network StubChainProvider backs deposits/withdrawals.
 *   live payments ON   →  LIVE mode: the faucet is gone and the real Tron
 *                         provider moves money on-chain.
 *
 * Read with the service role (the flag drives provider selection in trusted
 * server code); written only through the admin-gated set_live_payments RPC.
 */

/**
 * Is the platform in LIVE (real-money) mode? Service-role read.
 *
 * FAIL-SAFE: any read error returns false (TEST mode). We must never silently
 * fall into moving real money because a settings read hiccuped — and in TEST
 * mode the production faucet is still hard-blocked by NODE_ENV, so a false
 * negative is harmless, while a false positive would be dangerous.
 */
export async function isLivePaymentsEnabled(): Promise<boolean> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("platform_settings")
    .select("live_payments")
    .eq("id", true)
    .maybeSingle();
  if (error) {
    // Before migration 0018 is applied the table doesn't exist. That's a normal
    // pre-migration state, not a fault — treat it as TEST mode silently rather
    // than logging on every request. PostgREST reports a missing table as
    // PGRST205 ("Could not find the table … in the schema cache").
    const missingTable =
      error.code === "PGRST205" ||
      /platform_settings/.test(error.message ?? "");
    if (!missingTable) {
      console.error(
        `[settings] failed to read live_payments: ${error.message}`,
      );
    }
    return false;
  }
  return data?.live_payments === true;
}

/**
 * Flip the live-payments switch. Goes through the service-role RPC, which
 * re-checks is_admin (defence in depth). The caller must already have verified
 * the actor is an admin and — when enabling — that the chain provider is
 * configured (see the admin action).
 */
export async function setLivePayments(
  adminId: string,
  enabled: boolean,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("set_live_payments", {
    p_admin: adminId,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
}
