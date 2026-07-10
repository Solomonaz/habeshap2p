"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { AD_STATUSES } from "@/types/domain";
import { sellMaxExceedsBalance, maxEtbForBalance } from "@/lib/ad-capacity";
import { formatEtb } from "@/lib/format";

const schema = z.object({
  adId: z.string().uuid(),
  status: z.enum(AD_STATUSES),
});

export type SetAdStatusState = { error?: string };

/**
 * Changes one of the current user's ads to PAUSED / ACTIVE / CLOSED. RLS only
 * lets a user update their own ads, so ownership is enforced by the database;
 * the explicit user_id filter is belt-and-braces and scopes the row.
 */
export async function setAdStatus(
  _prev: SetAdStatusState,
  formData: FormData,
): Promise<SetAdStatusState> {
  const parsed = schema.safeParse({
    adId: formData.get("adId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: "Invalid request" };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("ads")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.adId)
    .eq("user_id", user.id);

  if (error) return { error: `Could not update ad: ${error.message}` };

  revalidatePath("/market/mine");
  revalidatePath("/market");
  return {};
}

/** A positive decimal string with up to 2 fractional digits (ETB amounts). */
const etbAmount = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter a valid amount")
  .refine((v) => Number(v) > 0, "Must be greater than zero");

/**
 * The price (rate) is stored with up to 4 decimals and comes back that way (e.g.
 * "210.0000"), so its field allows 4 fractional digits — the 2-decimal `etbAmount`
 * would reject the value the form pre-fills from the ad.
 */
const rateEtb = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,4})?$/, "Enter a valid price")
  .refine((v) => Number(v) > 0, "Must be greater than zero");

const limitsSchema = z
  .object({
    adId: z.string().uuid(),
    rate_etb: rateEtb,
    min_etb: etbAmount,
    max_etb: etbAmount,
  })
  .refine((v) => Number(v.min_etb) <= Number(v.max_etb), {
    message: "Minimum cannot exceed maximum",
    path: ["min_etb"],
  });

export type UpdateAdLimitsState = { error?: string; ok?: boolean };

/**
 * Update the price + min/max limits of one of the current user's ads. This is the
 * fix for a SELL ad whose max fell out of sync with the seller's balance: they can
 * lower the max (or the whole band) here so buyers see fundable limits again.
 *
 * RLS restricts the update to the owner's own ad (belt-and-braces user_id filter).
 * For a SELL ad the new max must be coverable by the seller's current USDT — the
 * same check createAd runs at post time — so the update can't re-introduce a limit
 * the seller can't fund.
 */
export async function updateAdLimits(
  _prev: UpdateAdLimitsState,
  formData: FormData,
): Promise<UpdateAdLimitsState> {
  const parsed = limitsSchema.safeParse({
    adId: formData.get("adId"),
    rate_etb: formData.get("rate_etb"),
    min_etb: formData.get("min_etb"),
    max_etb: formData.get("max_etb"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Load the ad AS THE USER (RLS scopes it to their own) to know its side.
  const { data: ad, error: loadErr } = await supabase
    .from("ads")
    .select("side")
    .eq("id", parsed.data.adId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (loadErr) return { error: `Could not load ad: ${loadErr.message}` };
  if (!ad) return { error: "Ad not found." };

  if (ad.side === "SELL") {
    const { data: wallet } = await supabase
      .from("wallets")
      .select("usdt_available::text")
      .eq("user_id", user.id)
      .single();
    const available = wallet?.usdt_available ?? "0";
    if (
      sellMaxExceedsBalance(parsed.data.max_etb, available, parsed.data.rate_etb)
    ) {
      const cap = maxEtbForBalance(available, parsed.data.rate_etb);
      return {
        error:
          `Your max of ${formatEtb(parsed.data.max_etb)} ETB is more than your ` +
          `${available} USDT balance can cover at this rate. Lower the max to ` +
          `${formatEtb(cap)} ETB or less, or deposit more USDT.`,
      };
    }
  }

  const { error } = await supabase
    .from("ads")
    .update({
      rate_etb: parsed.data.rate_etb,
      min_etb: parsed.data.min_etb,
      max_etb: parsed.data.max_etb,
    })
    .eq("id", parsed.data.adId)
    .eq("user_id", user.id);
  if (error) return { error: `Could not update ad: ${error.message}` };

  revalidatePath("/market/mine");
  revalidatePath("/market");
  return { ok: true };
}
