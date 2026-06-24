import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { toMicros } from "@/lib/money";
import type { PaymentMethod } from "@/types/domain";

export type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

/**
 * Escrow lifecycle wrappers over the transactional SQL functions (migration
 * 0007). Each runs as service_role (bypassing RLS) but passes the AUTHENTICATED
 * user as the actor, and the SQL re-checks that the actor is the right party —
 * so authorization is enforced in the database, not merely trusted here.
 *
 * RULE #1: only `release` moves escrow to the buyer, and only when the actor is
 * the seller. `markPaid` never touches balances.
 */

/** Open an order against an ad. The seller's USDT is locked atomically. */
export async function createOrder(args: {
  adId: string;
  takerId: string;
  amountUsdt: string;
  paymentMethod: PaymentMethod;
  buyerPaymentName: string;
  ttlMinutes?: number;
}): Promise<string> {
  if (toMicros(args.amountUsdt) <= 0n) {
    throw new Error("order amount must be positive");
  }
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("order_create", {
    p_ad: args.adId,
    p_taker: args.takerId,
    p_amount_usdt: args.amountUsdt,
    p_payment_method: args.paymentMethod,
    p_buyer_payment_name: args.buyerPaymentName,
    ...(args.ttlMinutes ? { p_ttl_minutes: args.ttlMinutes } : {}),
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("order_create returned no id");
  return data;
}

/** Buyer signals they have sent the ETB. No balance change. */
export async function markPaid(orderId: string, actorId: string): Promise<void> {
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("order_mark_paid", {
    p_order: orderId,
    p_actor: actorId,
  });
  if (error) throw new Error(error.message);
}

/** Seller confirms receipt: escrow → buyer (net), taker fee → platform. */
export async function release(orderId: string, actorId: string): Promise<void> {
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("order_release", {
    p_order: orderId,
    p_actor: actorId,
  });
  if (error) throw new Error(error.message);
}

/** Cancel an unpaid order; escrow returns to the seller. */
export async function cancel(orderId: string, actorId: string): Promise<void> {
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("order_cancel", {
    p_order: orderId,
    p_actor: actorId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Expire ONE order if it is overdue and still unpaid (CREATED + past deadline).
 * Idempotent: returns true only if this call cancelled it, false otherwise. Lets
 * the UI auto-cancel the instant its countdown ends, instead of waiting on the
 * cron. The SQL re-checks the deadline, so a not-yet-due order is never touched.
 */
export async function expireOrderIfDue(orderId: string): Promise<boolean> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("order_expire_due", {
    p_order: orderId,
  });
  if (error) throw new Error(error.message);
  return data ?? false;
}

/**
 * Freeze ONE seller if their PAID order's release window has elapsed: sweeps the
 * seller's whole spendable wallet (available + bond) into a frozen bucket,
 * temp-bans the account, and auto-opens a dispute (flipping the order to
 * DISPUTED). Idempotent: returns true only if this call performed the freeze,
 * false otherwise. The SQL re-checks state + deadline, so it is safe to call any
 * time — a not-yet-due or non-PAID order is never touched.
 */
export async function freezeSellerIfDue(orderId: string): Promise<boolean> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("order_freeze_seller", {
    p_order: orderId,
  });
  if (error) throw new Error(error.message);
  return data ?? false;
}

/** Cron sweep: cancel every CREATED order past its deadline. Returns count. */
export async function expireUnpaid(): Promise<number> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("order_expire_unpaid", {});
  if (error) throw new Error(error.message);
  return data ?? 0;
}

/**
 * Cron sweep: freeze every seller whose PAID order is past its release deadline
 * (whole wallet frozen, temp-ban, auto-dispute). The backstop for the order-page
 * trigger so the penalty fires even when nobody views the order. Returns count.
 */
export async function freezeOverdue(): Promise<number> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("order_freeze_overdue", {});
  if (error) throw new Error(error.message);
  return data ?? 0;
}

const ORDER_COLUMNS =
  "id, ad_id, buyer_id, seller_id, amount_usdt::text, rate_etb::text, amount_etb::text, fee_usdt::text, state, payment_method, buyer_payment_name, paid_at, released_at, cancelled_at, expires_at, created_at";

/** Orders the user is a party to (buyer or seller), newest first. RLS-scoped. */
export async function fetchMyOrders(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<OrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`failed to load orders: ${error.message}`);
  return data ?? [];
}

/** A single order the user is a party to (RLS returns null otherwise). */
export async function fetchOrder(
  supabase: SupabaseClient<Database>,
  orderId: string,
): Promise<OrderRow | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(`failed to load order: ${error.message}`);
  return data;
}
