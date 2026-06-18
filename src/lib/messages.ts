import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

/** Storage bucket holding payment-proof images (private; see migration 0008). */
export const PROOF_BUCKET = "trade-proofs";

/**
 * Chat + payment-proof access for a single order. Every call runs through the
 * RLS session client (as the signed-in user), so the database guarantees a user
 * only ever sees / writes messages for orders they are a party to — there is no
 * trust placed in the caller here.
 *
 * `image_url` stores the storage OBJECT PATH (not a URL). The bucket is private,
 * so images are rendered via short-lived signed URLs minted on demand.
 */

/** Oldest-first message history for an order. */
export async function fetchMessages(
  supabase: SupabaseClient<Database>,
  orderId: string,
): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, order_id, sender_id, body, image_url, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to load messages: ${error.message}`);
  return data ?? [];
}

/** Insert a chat message. `senderId` must be the signed-in user (RLS re-checks). */
export async function sendMessage(
  supabase: SupabaseClient<Database>,
  args: {
    orderId: string;
    senderId: string;
    body?: string | null;
    imagePath?: string | null;
  },
): Promise<void> {
  const body = args.body?.trim() ? args.body.trim() : null;
  const imageUrl = args.imagePath ?? null;
  if (!body && !imageUrl) {
    throw new Error("message must have text or an image");
  }
  const { error } = await supabase.from("messages").insert({
    order_id: args.orderId,
    sender_id: args.senderId,
    body,
    image_url: imageUrl,
  });
  if (error) throw new Error(`failed to send message: ${error.message}`);
}

/**
 * Uploads a payment-proof image to the private bucket under the order's path
 * prefix (`<orderId>/<random>.<ext>`), which is what the storage RLS policies
 * key off. Returns the stored object path to persist in `messages.image_url`.
 */
export async function uploadProof(
  supabase: SupabaseClient<Database>,
  orderId: string,
  file: File,
): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  const path = `${orderId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(PROOF_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`upload failed: ${error.message}`);
  return path;
}

/** Mints a short-lived signed URL for a stored proof object path. */
export async function signedProofUrl(
  supabase: SupabaseClient<Database>,
  path: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(PROOF_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}
