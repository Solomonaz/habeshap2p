"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { createOrder } from "@/lib/orders";
import { PAYMENT_METHODS } from "@/types/domain";

const schema = z.object({
  adId: z.string().uuid(),
  amount_usdt: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,6})?$/, "Enter a valid USDT amount")
    .refine((v) => Number(v) > 0, "Must be greater than zero"),
  payment_method: z.enum(PAYMENT_METHODS),
  // Only meaningful when the taker is the buyer (SELL ad). The SQL ignores it
  // for BUY ads (it uses the advertiser's stored payer_name instead).
  buyer_payment_name: z.string().trim().optional(),
});

export type OpenOrderState = { error?: string };

export async function openOrder(
  _prev: OpenOrderState,
  formData: FormData,
): Promise<OpenOrderState> {
  const parsed = schema.safeParse({
    adId: formData.get("adId"),
    amount_usdt: formData.get("amount_usdt"),
    payment_method: formData.get("payment_method"),
    buyer_payment_name: formData.get("buyer_payment_name") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let orderId: string;
  try {
    // All the real guards (ad active, within limits, method offered, seller has
    // balance, parties distinct) run inside order_create in one transaction.
    orderId = await createOrder({
      adId: parsed.data.adId,
      takerId: user.id,
      amountUsdt: parsed.data.amount_usdt,
      paymentMethod: parsed.data.payment_method,
      buyerPaymentName: parsed.data.buyer_payment_name ?? "",
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not open order" };
  }

  redirect(`/orders/${orderId}`);
}
