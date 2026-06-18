"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { AD_SIDES, PAYMENT_METHODS } from "@/types/domain";

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
    return { error: `Could not post ad: ${error.message}` };
  }

  redirect("/market/mine");
}
