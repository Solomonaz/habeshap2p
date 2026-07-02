import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server";
import { toMicros } from "@/lib/money";
import { traderName } from "@/lib/handle";

/**
 * Free internal transfers (migration 0046): move USDT from one user's available
 * balance to another's, addressed by the recipient's HabeshaP2P ID. Pure ledger
 * move — no chain, no gas, no fee. All authorization + fund checks live in the
 * SECURITY DEFINER `internal_transfer` RPC; these are thin service-role wrappers.
 */

/** Resolve a HabeshaP2P ID to a recipient (id + display name), or null. */
export async function lookupUserByPublicId(
  publicId: string,
): Promise<{ id: string; name: string } | null> {
  const normalized = publicId.replace(/[^0-9]/g, "");
  if (!normalized) return null;
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("users")
    .select("id, full_name")
    .eq("public_id", normalized)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    name: traderName((data as { full_name: string | null }).full_name, data.id),
  };
}

/**
 * Send USDT to another user by their HabeshaP2P ID. Returns the recipient's user
 * id. Throws with a user-safe message on any rejection (self-send, unknown ID,
 * unverified sender, insufficient funds — all enforced in SQL).
 */
export async function internalTransfer(args: {
  senderId: string;
  recipientPublicId: string;
  amount: string;
}): Promise<string> {
  if (toMicros(args.amount) <= 0n) {
    throw new Error("transfer amount must be positive");
  }
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("internal_transfer", {
    p_sender: args.senderId,
    p_recipient_id: args.recipientPublicId,
    p_amount: args.amount,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("internal_transfer returned no recipient");
  return data;
}
