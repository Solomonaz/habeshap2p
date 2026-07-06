import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server";
import { toMicros, fromMicros } from "@/lib/money";

/**
 * Referral program reads (migration 0050). A user's referral code is their
 * public_id (HabeshaP2P ID); they earn a share of the platform fee whenever
 * someone who signed up with their code completes a trade. Service-role reads,
 * scoped to the given user — the count/earnings span other users' rows and
 * ledger entries that RLS would otherwise hide from the session client.
 */
export type ReferralStats = {
  /** The user's referral code = their public_id. */
  code: string | null;
  /** How many users signed up with this user's code. */
  referralCount: number;
  /** Total USDT earned from referrals so far (exact decimal string). */
  totalEarned: string;
};

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const admin = createAdminSupabase();
  const [me, refs, earns] = await Promise.all([
    admin.from("users").select("public_id").eq("id", userId).maybeSingle(),
    admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("referred_by", userId),
    admin
      .from("ledger_entries")
      .select("amount_usdt::text")
      .eq("user_id", userId)
      .eq("type", "REFERRAL"),
  ]);

  let micros = 0n;
  for (const r of (earns.data ?? []) as { amount_usdt: string }[]) {
    micros += toMicros(r.amount_usdt);
  }

  return {
    code: me.data?.public_id ?? null,
    referralCount: refs.count ?? 0,
    totalEarned: fromMicros(micros),
  };
}
