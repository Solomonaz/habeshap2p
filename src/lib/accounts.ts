import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { AccountStatus } from "@/lib/supabase/database.types";

/**
 * Account-standing reads + the reinstatement (appeal) action, layered over the
 * SQL function `account_reinstate` (migration 0027). Like the other admin reads,
 * these go through the service-role client and MUST only be called from routes
 * already guarded by an is_admin check — the SQL re-verifies is_admin anyway.
 */

export type ModeratedAccount = {
  userId: string;
  accountStatus: AccountStatus;
  frozenAt: string | null;
  banReason: string | null;
  /** Currently-frozen balance (relevant while FROZEN, before any ruling). */
  frozenUsdt: string;
  /** Net funds forfeited to the platform for this user (relevant once BANNED). */
  forfeitedUsdt: string;
  /** The dispute that froze/banned this account, if one is on record. */
  disputeId: string | null;
  orderId: string | null;
};

/** Sum a list of ledger rows into a net FORFEIT − UNFORFEIT figure (as string). */
function netForfeited(
  rows: { type: string; amount_usdt: string }[],
): string {
  // Work in integer micros to stay exact (amounts are numeric(20,6)).
  let micros = 0n;
  for (const r of rows) {
    const [whole, frac = ""] = r.amount_usdt.split(".");
    const m = BigInt(whole + frac.padEnd(6, "0").slice(0, 6));
    if (r.type === "FORFEIT") micros += m;
    else if (r.type === "UNFORFEIT") micros -= m;
  }
  if (micros < 0n) micros = 0n;
  const s = micros.toString().padStart(7, "0");
  const whole = s.slice(0, -6);
  const frac = s.slice(-6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Every account currently under moderation (FROZEN awaiting a ruling, or BANNED),
 * newest trouble first, each linked to the dispute that put it there so an admin
 * can open the full record and rule / appeal.
 */
export async function fetchModeratedAccounts(): Promise<ModeratedAccount[]> {
  const supabase = createAdminSupabase();

  const { data: users, error } = await supabase
    .from("users")
    .select("id, account_status, frozen_at, ban_reason")
    .in("account_status", ["FROZEN", "BANNED"])
    .order("frozen_at", { ascending: false });
  if (error) throw new Error(`failed to load moderated accounts: ${error.message}`);

  const ids = (users ?? []).map((u) => u.id);
  if (ids.length === 0) return [];

  // Batch the satellite reads: frozen balances, forfeiture ledger, and the
  // dispute/order each account is tied to (the latest order where they sell).
  const [wallets, ledger, orders] = await Promise.all([
    supabase.from("wallets").select("user_id, usdt_frozen::text").in("user_id", ids),
    supabase
      .from("ledger_entries")
      .select("user_id, type, amount_usdt::text")
      .in("user_id", ids)
      .in("type", ["FORFEIT", "UNFORFEIT"]),
    supabase
      .from("orders")
      .select("id, seller_id, created_at")
      .in("seller_id", ids)
      .order("created_at", { ascending: false }),
  ]);

  const frozenByUser = new Map<string, string>();
  for (const w of (wallets.data ?? []) as { user_id: string; usdt_frozen: string }[]) {
    frozenByUser.set(w.user_id, w.usdt_frozen ?? "0");
  }

  const ledgerByUser = new Map<string, { type: string; amount_usdt: string }[]>();
  for (const l of (ledger.data ?? []) as {
    user_id: string;
    type: string;
    amount_usdt: string;
  }[]) {
    const list = ledgerByUser.get(l.user_id) ?? [];
    list.push({ type: l.type, amount_usdt: l.amount_usdt });
    ledgerByUser.set(l.user_id, list);
  }

  // First (newest) order per seller — the one whose dispute this account hangs on.
  const latestOrderByUser = new Map<string, string>();
  for (const o of (orders.data ?? []) as { id: string; seller_id: string }[]) {
    if (!latestOrderByUser.has(o.seller_id)) latestOrderByUser.set(o.seller_id, o.id);
  }
  const orderIds = [...latestOrderByUser.values()];
  const disputeByOrder = new Map<string, string>();
  if (orderIds.length > 0) {
    const { data: disputes } = await supabase
      .from("disputes")
      .select("id, order_id")
      .in("order_id", orderIds);
    for (const d of (disputes ?? []) as { id: string; order_id: string }[]) {
      disputeByOrder.set(d.order_id, d.id);
    }
  }

  return (users ?? []).map((u) => {
    const orderId = latestOrderByUser.get(u.id) ?? null;
    return {
      userId: u.id,
      accountStatus: (u.account_status ?? "ACTIVE") as AccountStatus,
      frozenAt: u.frozen_at,
      banReason: u.ban_reason,
      frozenUsdt: frozenByUser.get(u.id) ?? "0",
      forfeitedUsdt: netForfeited(ledgerByUser.get(u.id) ?? []),
      disputeId: orderId ? disputeByOrder.get(orderId) ?? null : null,
      orderId,
    };
  });
}

/**
 * Reinstate a permanently-banned account on appeal: returns the forfeited funds
 * to the seller and reactivates the account. Returns the USDT amount returned.
 * The SQL re-checks is_admin and that the account is actually BANNED.
 */
export async function reinstateAccount(args: {
  userId: string;
  adminId: string;
}): Promise<string> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("account_reinstate", {
    p_user: args.userId,
    p_admin: args.adminId,
  });
  if (error) throw new Error(error.message);
  return String(data ?? "0");
}
