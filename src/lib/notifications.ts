import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type NotificationRow =
  Database["public"]["Tables"]["notifications"]["Row"];

export type NewNotification = {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  audience?: "user" | "admin";
};

/**
 * Create one or more notifications (service role → bypasses RLS).
 *
 * CRITICAL: a notification is a side effect of some real action (an order, a
 * payout, a ruling). It must NEVER break that action — so failures are logged
 * and swallowed, not thrown. The caller's money/state change has already
 * committed by the time we notify.
 */
export async function createNotification(
  n: NewNotification | NewNotification[],
): Promise<void> {
  const list = Array.isArray(n) ? n : [n];
  const rows = list
    .filter((x) => x.userId)
    .map((x) => ({
      user_id: x.userId,
      type: x.type,
      title: x.title,
      body: x.body ?? null,
      href: x.href ?? null,
      audience: x.audience ?? "user",
    }));
  if (rows.length === 0) return;
  try {
    const admin = createAdminSupabase();
    const { error } = await admin.from("notifications").insert(rows);
    if (error) console.error(`[notify] insert failed: ${error.message}`);
  } catch (e) {
    console.error(
      `[notify] insert threw: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Fan a notification out to every admin (new dispute, withdrawal to approve…). */
export async function notifyAdmins(n: {
  type: string;
  title: string;
  body?: string;
  href?: string;
}): Promise<void> {
  try {
    const admin = createAdminSupabase();
    const { error } = await admin.rpc("notify_admins", {
      p_type: n.type,
      p_title: n.title,
      p_body: n.body ?? null,
      p_href: n.href ?? null,
    });
    if (error) console.error(`[notify] notify_admins failed: ${error.message}`);
  } catch (e) {
    console.error(
      `[notify] notify_admins threw: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

const NOTIFICATION_COLUMNS =
  "id, user_id, type, title, body, href, audience, read_at, created_at";

/** The signed-in user's notifications (RLS-scoped), newest first. */
export async function fetchNotifications(
  supabase: SupabaseClient<Database>,
  userId: string,
  limit = 30,
): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error(`[notify] fetch failed: ${error.message}`);
    return [];
  }
  return (data ?? []) as NotificationRow[];
}

/** Count of unread notifications for the badge. */
export async function fetchUnreadCount(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) {
    console.error(`[notify] unread count failed: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}
