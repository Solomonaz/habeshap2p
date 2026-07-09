import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server";
import { createNotification } from "@/lib/notifications";
import {
  sellMaxExceedsBalance,
  maxEtbForBalance,
} from "@/lib/ad-capacity";
import { formatEtb } from "@/lib/format";

/**
 * After a seller's USDT balance drops (a completed trade, a withdrawal, a
 * transfer), their ACTIVE SELL ad may now advertise a max order they can no
 * longer fund — buyers would see a stale limit and fail to open orders. This
 * checks that ad against the seller's CURRENT balance and, if the max exceeds
 * what they can cover, fires a notification (which the bell plays a sound for)
 * nudging them to lower the limit or top up.
 *
 * Best-effort and self-contained: it never throws (a notification must never
 * undo the money action that triggered it) and does nothing when there's no
 * ACTIVE SELL ad or the ad is still fully funded.
 */
export async function notifyIfSellAdUnderfunded(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const admin = createAdminSupabase();

    // At most one open SELL ad per user (one-ad-per-side rule). Only an ACTIVE ad
    // is shown to buyers, so only that one is worth alerting on.
    const { data: ad } = await admin
      .from("ads")
      .select("id, rate_etb::text, min_etb::text, max_etb::text")
      .eq("user_id", userId)
      .eq("side", "SELL")
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (!ad) return;

    const { data: wallet } = await admin
      .from("wallets")
      .select("usdt_available::text")
      .eq("user_id", userId)
      .single();
    const available = wallet?.usdt_available ?? "0";

    if (!sellMaxExceedsBalance(ad.max_etb, available, ad.rate_etb)) return;

    const cap = maxEtbForBalance(available, ad.rate_etb);
    await createNotification({
      userId,
      type: "ad_underfunded",
      title: "Update your ad's limit",
      body:
        `Your sell ad's max of ${formatEtb(ad.max_etb)} ETB is now more than ` +
        `your ${available} USDT balance can cover. Buyers may fail to open ` +
        `orders — lower the max to ${formatEtb(cap)} ETB or deposit more USDT.`,
      href: "/market/mine",
    });
  } catch {
    /* best-effort: alerting must never break the action that triggered it */
  }
}
