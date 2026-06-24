"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  markPaid,
  release,
  cancel,
  fetchOrder,
  expireOrderIfDue,
  freezeSellerIfDue,
} from "@/lib/orders";
import { openDispute } from "@/lib/disputes";

const schema = z.object({
  orderId: z.string().uuid(),
  intent: z.enum(["paid", "release", "cancel", "dispute"]),
  reason: z.string().trim().min(1).max(1000).optional(),
});

export type OrderActionState = { error?: string };

/**
 * Single entry point for the buyer/seller order controls. The authenticated
 * user is passed as the actor; the SQL functions re-verify that the actor is the
 * correct party for the requested transition (rule #1: only the seller can
 * release). We never trust the client to say who it is.
 */
export async function runOrderAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const parsed = schema.safeParse({
    orderId: formData.get("orderId"),
    intent: formData.get("intent"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) return { error: "Invalid request" };
  if (parsed.data.intent === "dispute" && !parsed.data.reason) {
    return { error: "Describe the problem so an admin can review it." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  try {
    switch (parsed.data.intent) {
      case "paid":
        await markPaid(parsed.data.orderId, user.id);
        break;
      case "release":
        await release(parsed.data.orderId, user.id);
        break;
      case "cancel":
        await cancel(parsed.data.orderId, user.id);
        break;
      case "dispute":
        await openDispute({
          orderId: parsed.data.orderId,
          actorId: user.id,
          reason: parsed.data.reason!,
        });
        break;
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Action failed" };
  }

  revalidatePath(`/orders/${parsed.data.orderId}`);
  return {};
}

const expireSchema = z.object({ orderId: z.string().uuid() });

/**
 * Fired by the order page the moment its payment countdown reaches zero, so an
 * overdue unpaid order is auto-cancelled on view instead of waiting for the
 * background cron. Authorization: the caller must be a party to the order (RLS
 * returns it only to the buyer/seller); the SQL re-checks the deadline and only
 * cancels a genuinely overdue CREATED order, so this is safe to call any time.
 */
export async function expireOrderAction(orderId: string): Promise<void> {
  const parsed = expireSchema.safeParse({ orderId });
  if (!parsed.success) return;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // RLS scopes this to orders the user is a party to; non-parties get null.
  const order = await fetchOrder(supabase, parsed.data.orderId);
  if (!order) return;

  try {
    const cancelled = await expireOrderIfDue(parsed.data.orderId);
    if (cancelled) revalidatePath(`/orders/${parsed.data.orderId}`);
  } catch {
    // Best-effort; the cron remains the backstop if this transient-fails.
  }
}

/**
 * Fired by the order page the moment a PAID order's release countdown reaches
 * zero. The seller missed their window, so the database freezes the seller's
 * whole spendable wallet, temp-bans them, and auto-opens a dispute (order →
 * DISPUTED) for an admin to rule on. Authorization mirrors expireOrderAction:
 * the caller must be a party (RLS returns the order only to buyer/seller); the
 * SQL re-checks the PAID state + deadline so this is safe to call any time.
 */
export async function freezeSellerAction(orderId: string): Promise<void> {
  const parsed = expireSchema.safeParse({ orderId });
  if (!parsed.success) return;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // RLS scopes this to orders the user is a party to; non-parties get null.
  const order = await fetchOrder(supabase, parsed.data.orderId);
  if (!order) return;

  try {
    const frozen = await freezeSellerIfDue(parsed.data.orderId);
    if (frozen) revalidatePath(`/orders/${parsed.data.orderId}`);
  } catch {
    // Best-effort; the cron remains the backstop if this transient-fails.
  }
}
