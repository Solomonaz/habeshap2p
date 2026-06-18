import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { DisputeResolution } from "@/types/domain";
import type { OrderRow } from "@/lib/orders";
import { fetchMessages, signedProofUrl, type MessageRow } from "@/lib/messages";

export type DisputeRow = Database["public"]["Tables"]["disputes"]["Row"];

/**
 * Dispute lifecycle wrappers over the transactional SQL functions (migration
 * 0010). As with the escrow RPCs, each runs as service_role but passes the
 * AUTHENTICATED user as the actor/admin, and the SQL re-verifies authorization
 * (party for opening, is_admin for resolving) — never trusted from the client.
 */

/** A party escalates a PAID order to DISPUTED. Returns the new dispute id. */
export async function openDispute(args: {
  orderId: string;
  actorId: string;
  reason: string;
}): Promise<string> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("order_open_dispute", {
    p_order: args.orderId,
    p_actor: args.actorId,
    p_reason: args.reason,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("order_open_dispute returned no id");
  return data;
}

/**
 * Admin ruling. FAVOUR_BUYER releases the full escrow to the buyer (order
 * RELEASED); FAVOUR_SELLER refunds the seller (order CANCELLED). The SQL
 * re-checks `is_admin` on the actor.
 */
export async function resolveDispute(args: {
  disputeId: string;
  adminId: string;
  resolution: DisputeResolution;
}): Promise<void> {
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("dispute_resolve", {
    p_dispute: args.disputeId,
    p_admin: args.adminId,
    p_resolution: args.resolution,
  });
  if (error) throw new Error(error.message);
}

const DISPUTE_COLUMNS =
  "id, order_id, opened_by, reason, status, resolution, resolved_by, created_at, resolved_at";

/**
 * The dispute attached to an order, read through the RLS session client (a
 * party or the opener sees it; anyone else gets null). Used on the order page.
 */
export async function fetchDisputeForOrder(
  supabase: SupabaseClient<Database>,
  orderId: string,
): Promise<DisputeRow | null> {
  const { data, error } = await supabase
    .from("disputes")
    .select(DISPUTE_COLUMNS)
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw new Error(`failed to load dispute: ${error.message}`);
  return data;
}

// ── Admin reads ──────────────────────────────────────────────────────────────
// Admins are not parties to the orders they arbitrate, so RLS (which scopes
// disputes/orders/messages to parties) would hide everything from them. These
// reads therefore go through the service-role client and MUST only be called
// from routes already guarded by an is_admin check (see requireAdmin).

export type AdminDisputeSummary = DisputeRow & { order: OrderRow };

/** Admin queue: disputes by status (default the unresolved ones), newest first. */
export async function fetchDisputesForAdmin(
  opts: { resolved?: boolean } = {},
): Promise<AdminDisputeSummary[]> {
  const supabase = createAdminSupabase();
  const orderCols =
    "id, ad_id, buyer_id, seller_id, amount_usdt::text, rate_etb::text, amount_etb::text, fee_usdt::text, state, payment_method, buyer_payment_name, paid_at, released_at, cancelled_at, expires_at, created_at";
  const base = supabase
    .from("disputes")
    .select(`${DISPUTE_COLUMNS}, order:orders(${orderCols})`);
  // The queue is "everything not yet resolved" (OPEN or UNDER_REVIEW), so a
  // future intermediate status still surfaces rather than silently hiding.
  const query = opts.resolved
    ? base.eq("status", "RESOLVED")
    : base.neq("status", "RESOLVED");
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw new Error(`failed to load disputes: ${error.message}`);
  // PostgREST returns the embedded order as an object (one-to-one via FK).
  return (data ?? []).map((d) => {
    const { order, ...rest } = d as DisputeRow & { order: OrderRow };
    return { ...(rest as DisputeRow), order };
  });
}

export type AdminProofMessage = MessageRow & { proofUrl: string | null };

export type AdminDisputeDetail = {
  dispute: DisputeRow;
  order: OrderRow;
  messages: AdminProofMessage[];
};

/**
 * Everything an admin needs to rule: the dispute, the order, and the full chat
 * transcript with signed URLs for any payment-proof images. Service-role read;
 * caller must have already verified the user is an admin.
 */
export async function fetchDisputeDetailForAdmin(
  disputeId: string,
): Promise<AdminDisputeDetail | null> {
  const supabase = createAdminSupabase();
  const { data: dispute, error } = await supabase
    .from("disputes")
    .select(DISPUTE_COLUMNS)
    .eq("id", disputeId)
    .maybeSingle();
  if (error) throw new Error(`failed to load dispute: ${error.message}`);
  if (!dispute) return null;

  const orderCols =
    "id, ad_id, buyer_id, seller_id, amount_usdt::text, rate_etb::text, amount_etb::text, fee_usdt::text, state, payment_method, buyer_payment_name, paid_at, released_at, cancelled_at, expires_at, created_at";
  const { data: order, error: oErr } = await supabase
    .from("orders")
    .select(orderCols)
    .eq("id", dispute.order_id)
    .maybeSingle();
  if (oErr) throw new Error(`failed to load order: ${oErr.message}`);
  if (!order) return null;

  const raw = await fetchMessages(supabase, dispute.order_id);
  const messages: AdminProofMessage[] = await Promise.all(
    raw.map(async (m) => ({
      ...m,
      proofUrl: m.image_url ? await signedProofUrl(supabase, m.image_url) : null,
    })),
  );

  return { dispute, order, messages };
}
