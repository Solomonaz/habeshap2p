import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { AccountStatus } from "@/lib/supabase/database.types";
import { toMicros, fromMicros } from "@/lib/money";

/**
 * Account-standing reads + the reinstatement (appeal) action, layered over the
 * SQL function `account_reinstate` (migration 0027). Like the other admin reads,
 * these go through the service-role client and MUST only be called from routes
 * already guarded by an is_admin check — the SQL re-verifies is_admin anyway.
 */

/** A search hit in admin account management. */
export type AccountSearchResult = {
  userId: string;
  fullName: string | null;
  email: string | null;
  publicId: string | null;
  accountStatus: AccountStatus;
  banReason: string | null;
  isAdmin: boolean;
  forfeitedUsdt: string;
};

/**
 * Find accounts by email, name, or HabeshaP2P ID (public_id / UID) for the admin
 * moderation tools. Service-role read; caller must be an admin. Empty query
 * returns nothing (no dumping the whole user table).
 */
export async function searchAccounts(
  query: string,
): Promise<AccountSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const admin = createAdminSupabase();
  // Match email/name (case-insensitive substring) or an exact public_id/UUID.
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const ors = [`email.ilike.${like}`, `full_name.ilike.${like}`, `public_id.eq.${q}`];
  if (/^[0-9a-f-]{36}$/i.test(q)) ors.push(`id.eq.${q}`);
  const { data, error } = await admin
    .from("users")
    .select("id, full_name, email, public_id, account_status, ban_reason, is_admin")
    .or(ors.join(","))
    .limit(20);
  if (error) throw new Error(`account search failed: ${error.message}`);
  const rows = (data ?? []) as {
    id: string;
    full_name: string | null;
    email: string | null;
    public_id: string | null;
    account_status: AccountStatus;
    ban_reason: string | null;
    is_admin: boolean;
  }[];
  if (rows.length === 0) return [];

  // Per-user forfeiture is recorded in the ledger (FORFEIT − UNFORFEIT), not a
  // wallet column — same source fetchModeratedAccounts uses. Lets the UI steer
  // forfeit-bans to Reinstate (which returns the funds) rather than plain unban.
  const { data: ledger } = await admin
    .from("ledger_entries")
    .select("user_id, type, amount_usdt::text")
    .in("user_id", rows.map((r) => r.id))
    .in("type", ["FORFEIT", "UNFORFEIT"]);
  const forfeitMicros = new Map<string, bigint>();
  for (const l of (ledger ?? []) as {
    user_id: string;
    type: string;
    amount_usdt: string;
  }[]) {
    const cur = forfeitMicros.get(l.user_id) ?? 0n;
    const d = toMicros(l.amount_usdt);
    forfeitMicros.set(l.user_id, l.type === "FORFEIT" ? cur + d : cur - d);
  }

  return rows.map((r) => ({
    userId: r.id,
    fullName: r.full_name,
    email: r.email,
    publicId: r.public_id,
    accountStatus: r.account_status,
    banReason: r.ban_reason,
    isAdmin: r.is_admin === true,
    forfeitedUsdt: fromMicros(
      (forfeitMicros.get(r.id) ?? 0n) > 0n
        ? forfeitMicros.get(r.id)!
        : 0n,
    ),
  }));
}

/** Admin bans an account (freezes funds + hides it). SQL re-checks is_admin. */
export async function banAccount(
  adminId: string,
  userId: string,
  reason: string,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("account_ban", {
    p_admin: adminId,
    p_user: userId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/** Admin lifts a ban, restoring the account to ACTIVE. SQL re-checks is_admin. */
export async function unbanAccount(
  adminId: string,
  userId: string,
): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("account_unban", {
    p_admin: adminId,
    p_user: userId,
  });
  if (error) throw new Error(error.message);
}

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
