import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type AdminAuditRow =
  Database["public"]["Tables"]["admin_audit_log"]["Row"];

/**
 * Admin audit trail (Phase 8). A human-readable who-did-what-when record of
 * privileged actions, complementing the money-moving ledger lines. Entries are
 * written through the service-role RPC `record_admin_action`, which re-checks
 * is_admin, and the table has no client INSERT/UPDATE/DELETE policy — so the log
 * is append-only even to admins through the API.
 */

/**
 * Record one privileged action. Best-effort and non-fatal: a failure to log must
 * never roll back or mask the action it describes (the money move already
 * succeeded and has its own ledger entry), so this swallows errors after warning.
 */
export async function recordAdminAction(args: {
  adminId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: string;
}): Promise<void> {
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("record_admin_action", {
    p_admin: args.adminId,
    p_action: args.action,
    p_target_type: args.targetType ?? null,
    p_target_id: args.targetId ?? null,
    p_detail: args.detail ?? null,
  });
  if (error) {
    console.error(`[admin-audit] failed to record "${args.action}": ${error.message}`);
  }
}

/**
 * Recent audit entries for the ops console (newest first). Service-role read;
 * the caller must have already verified the user is an admin.
 */
export async function fetchRecentAdminActions(
  limit = 50,
): Promise<AdminAuditRow[]> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("admin_audit_log")
    .select("id, admin_id, action, target_type, target_id, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`failed to load admin audit log: ${error.message}`);
  return (data ?? []) as AdminAuditRow[];
}

/** Overload kept for callers holding an RLS session client (admins can read). */
export async function fetchRecentAdminActionsAs(
  supabase: SupabaseClient<Database>,
  limit = 50,
): Promise<AdminAuditRow[]> {
  const { data, error } = await supabase
    .from("admin_audit_log")
    .select("id, admin_id, action, target_type, target_id, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`failed to load admin audit log: ${error.message}`);
  return (data ?? []) as AdminAuditRow[];
}
