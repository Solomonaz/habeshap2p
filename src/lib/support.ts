import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Trader ⇄ admin support messaging (migration 0061). One ongoing thread per
 * trader. Reads go through the passed RLS client (a trader sees only their own
 * thread; an admin sees all); writes + the admin inbox go through the SECURITY
 * DEFINER RPCs via the service role, which also fire the notification to the
 * other side.
 */

export type SupportMessageRow =
  Database["public"]["Tables"]["support_messages"]["Row"];

const COLUMNS = "id, user_id, from_admin, admin_id, body, read_at, created_at";

/** A single trader's thread, oldest first. RLS scopes it (own thread, or admin). */
export async function fetchSupportThread(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<SupportMessageRow[]> {
  const { data, error } = await supabase
    .from("support_messages")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to load support thread: ${error.message}`);
  return (data ?? []) as SupportMessageRow[];
}

/** Count of unread admin replies for a trader — drives their entry-point badge. */
export async function countUnreadSupportForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("support_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("from_admin", true)
    .is("read_at", null);
  if (error) return 0;
  return count ?? 0;
}

/** Trader posts to their own thread (notifies every admin). */
export async function sendUserSupportMessage(
  userId: string,
  body: string,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("support_user_send", {
    p_user: userId,
    p_body: body,
  });
  if (error) throw new Error(error.message);
}

/** Trader opens their thread → mark the admin replies read. */
export async function markSupportReadUser(userId: string): Promise<void> {
  const admin = createAdminSupabase();
  await admin.rpc("support_mark_read_user", { p_user: userId });
}

/** Admin replies on a trader's thread (notifies the trader). Caller is an admin. */
export async function adminReplySupport(
  adminId: string,
  userId: string,
  body: string,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("support_admin_send", {
    p_admin: adminId,
    p_user: userId,
    p_body: body,
  });
  if (error) throw new Error(error.message);
}

/** Admin opens a trader's thread → mark that trader's messages read. */
export async function markSupportReadAdmin(
  adminId: string,
  userId: string,
): Promise<void> {
  const admin = createAdminSupabase();
  await admin.rpc("support_mark_read_admin", { p_admin: adminId, p_user: userId });
}

export type SupportThreadSummary =
  Database["public"]["Functions"]["admin_support_threads"]["Returns"][number];

/** The admin inbox: one row per trader, newest activity first (service role). */
export async function fetchAdminSupportThreads(): Promise<
  SupportThreadSummary[]
> {
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("admin_support_threads");
  if (error) throw new Error(`failed to load support inbox: ${error.message}`);
  return data ?? [];
}

/** One trader's thread, read as an admin (service role bypasses RLS). */
export async function fetchSupportThreadForAdmin(
  userId: string,
): Promise<SupportMessageRow[]> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("support_messages")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to load support thread: ${error.message}`);
  return (data ?? []) as SupportMessageRow[];
}

/** Total unread from traders — drives the admin nav badge. */
export async function fetchAdminSupportUnread(): Promise<number> {
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("admin_support_unread_count");
  if (error) return 0;
  return Number(data ?? 0);
}
