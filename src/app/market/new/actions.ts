"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { AD_SIDES, PAYMENT_METHODS } from "@/types/domain";
import { sellMaxExceedsBalance, maxEtbForBalance } from "@/lib/ad-capacity";
import { formatEtb } from "@/lib/format";

/** A positive decimal string with up to 2 fractional digits (ETB amounts). */
const etbAmount = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter a valid amount")
  .refine((v) => Number(v) > 0, "Must be greater than zero");

const createAdSchema = z
  .object({
    side: z.enum(AD_SIDES),
    rate_etb: etbAmount,
    min_etb: etbAmount,
    max_etb: etbAmount,
    payment_methods: z
      .array(z.enum(PAYMENT_METHODS))
      .min(1, "Choose at least one payment method"),
    // For BUY ads the advertiser IS the buyer, so we capture the name they will
    // pay from now (rule #2) — it is copied onto each order a seller takes.
    payer_name: z.string().trim().optional(),
  })
  .refine((v) => Number(v.min_etb) <= Number(v.max_etb), {
    message: "Minimum cannot exceed maximum",
    path: ["min_etb"],
  })
  .refine((v) => v.side !== "BUY" || (v.payer_name?.length ?? 0) > 0, {
    message: "Enter the payment-account name you will pay from",
    path: ["payer_name"],
  });

export type CreateAdState = { error?: string };

export async function createAd(
  _prev: CreateAdState,
  formData: FormData,
): Promise<CreateAdState> {
  const parsed = createAdSchema.safeParse({
    side: formData.get("side"),
    rate_etb: formData.get("rate_etb"),
    min_etb: formData.get("min_etb"),
    max_etb: formData.get("max_etb"),
    payment_methods: formData.getAll("payment_methods"),
    payer_name: formData.get("payer_name") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // One open ad per side: a user may have at most one live SELL and one live BUY
  // ad. Refuse a second on the same side while one is still open (ACTIVE/PAUSED).
  // The DB partial unique index (migration 0028) is the hard backstop; this gives
  // a friendly message instead of a raw constraint error.
  const sideWord = parsed.data.side === "SELL" ? "SELL" : "BUY";
  const { data: existingAd } = await supabase
    .from("ads")
    .select("id")
    .eq("user_id", user.id)
    .eq("side", parsed.data.side)
    .neq("status", "CLOSED")
    .maybeSingle();
  if (existingAd) {
    return {
      error:
        `You already have an open ${sideWord} ad. Close it from “My ads” ` +
        `before posting another.`,
    };
  }

  // SELL ads deliver USDT from escrow, so the advertised max order must be
  // fundable from the seller's current USDT balance. Without this, an ad could
  // advertise a max far above what the seller holds (e.g. 100,000 ETB max on a
  // 73-USDT balance), and orders against it would only fail later at escrow time.
  if (parsed.data.side === "SELL") {
    const { data: wallet } = await supabase
      .from("wallets")
      .select("usdt_available::text")
      .eq("user_id", user.id)
      .single();
    const available = wallet?.usdt_available ?? "0";
    if (
      sellMaxExceedsBalance(
        parsed.data.max_etb,
        available,
        parsed.data.rate_etb,
      )
    ) {
      const cap = maxEtbForBalance(available, parsed.data.rate_etb);
      return {
        error:
          `Your max order of ${formatEtb(parsed.data.max_etb)} ETB is more than ` +
          `your ${available} USDT balance can cover at this rate. Lower the max ` +
          `to ${formatEtb(cap)} ETB or less, or deposit more USDT.`,
      };
    }
  }

  // Insert AS THE USER. The RLS insert policy requires user_id = auth.uid(),
  // so a forged user_id would be rejected by the database, not just trusted here.
  const { error } = await supabase.from("ads").insert({
    user_id: user.id,
    side: parsed.data.side,
    rate_etb: parsed.data.rate_etb,
    min_etb: parsed.data.min_etb,
    max_etb: parsed.data.max_etb,
    payment_methods: parsed.data.payment_methods,
    payer_name: parsed.data.side === "BUY" ? parsed.data.payer_name : null,
    status: "ACTIVE",
  });

  if (error) {
    // Belt-and-braces for the race the pre-check above can't win: two requests
    // can both pass the SELECT and then race to INSERT. The partial unique index
    // (migration 0028) rejects the loser with 23505 — turn that raw constraint
    // error into the same friendly message instead of a scary DB string.
    if (error.code === "23505") {
      return {
        error:
          `You already have an open ${sideWord} ad. Close it from “My ads” ` +
          `before posting another.`,
      };
    }
    return { error: `Could not post ad: ${error.message}` };
  }

  redirect("/market/mine");
}
