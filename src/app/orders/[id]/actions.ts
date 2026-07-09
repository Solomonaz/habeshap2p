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
import { createNotification, notifyAdmins } from "@/lib/notifications";
import { notifyIfSellAdUnderfunded } from "@/lib/ad-alerts";
import { formatUsdt } from "@/lib/money";

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

  // Notify the relevant party (and admins on a dispute). Best-effort — a
  // notification failure must never undo the action that just succeeded.
  try {
    const order = await fetchOrder(supabase, parsed.data.orderId);
    if (order) {
      const amt = formatUsdt(order.amount_usdt);
      const href = `/orders/${order.id}`;
      const counterparty =
        order.buyer_id === user.id ? order.seller_id : order.buyer_id;
      switch (parsed.data.intent) {
        case "paid":
          await createNotification({
            userId: order.seller_id,
            type: "order_paid",
            title: "Buyer marked payment sent",
            body: `${amt} USDT — confirm receipt, then release.`,
            href,
          });
          break;
        case "release":
          await createNotification({
            userId: order.buyer_id,
            type: "order_released",
            title: "USDT released",
            body: `${amt} USDT released to you — trade complete.`,
            href,
          });
          // The seller's balance just dropped by this order. If their live SELL
          // ad now advertises more than they can fund, nudge them (with a sound)
          // to lower its limit or top up before buyers hit failed orders.
          await notifyIfSellAdUnderfunded(order.seller_id);
          break;
        case "cancel":
          await createNotification({
            userId: counterparty,
            type: "order_cancelled",
            title: "Order cancelled",
            body: `A ${amt} USDT order was cancelled.`,
            href,
          });
          break;
        case "dispute":
          await createNotification({
            userId: counterparty,
            type: "order_disputed",
            title: "Order disputed",
            body: `A ${amt} USDT order was moved to dispute.`,
            href,
          });
          await notifyAdmins({
            type: "dispute_opened",
            title: "New dispute opened",
            body: `${amt} USDT order needs a ruling.`,
            href: "/admin",
          });
          break;
      }
    }
  } catch {
    /* notifications are best-effort */
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
