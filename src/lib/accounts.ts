import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { AccountStatus, KycStatus } from "@/lib/supabase/database.types";
import { toMicros, fromMicros } from "@/lib/money";

/**
 * Account-standing reads + the reinstatement (appeal) action, layered over the
 * SQL function `account_reinstate` (migration 0027). Like the other admin reads,
 * these go through the service-role client and MUST only be called from routes
 * already guarded by an is_admin check — the SQL re-verifies is_admin anyway.
 */

/** One account row in the admin management table. */
export type AccountRow = {
  userId: string;
  fullName: string | null;
  email: string | null;
  publicId: string | null;
  accountStatus: AccountStatus;
  banReason: string | null;
  isAdmin: boolean;
  forfeitedUsdt: string;
  createdAt: string;
  kycStatus: KycStatus;
  /** Whether the account confirmed its email/phone; false ⇒ shown "Inactive". */
  emailConfirmed: boolean;
};

type RawUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  public_id: string | null;
  account_status: AccountStatus;
  ban_reason: string | null;
  is_admin: boolean;
  created_at: string;
  kyc_status: KycStatus;
};

/**
 * Attach each user's net forfeited amount (FORFEIT − UNFORFEIT in the ledger —
 * per-user forfeiture isn't a wallet column). Lets the UI steer forfeit-bans to
 * Reinstate (which returns the funds) instead of a plain unban.
 */
async function toAccountRows(
  admin: ReturnType<typeof createAdminSupabase>,
  rows: RawUser[],
): Promise<AccountRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [{ data: ledger }, { data: emailRows }] = await Promise.all([
    admin
      .from("ledger_entries")
      .select("user_id, type, amount_usdt::text")
      .in("user_id", ids)
      .in("type", ["FORFEIT", "UNFORFEIT"]),
    // Email/phone confirmation lives on auth.users — read via the SECURITY
    // DEFINER helper (migration 0055).
    admin.rpc("accounts_email_confirmed", { p_ids: ids }),
  ]);

  const forfeit = new Map<string, bigint>();
  for (const l of (ledger ?? []) as {
    user_id: string;
    type: string;
    amount_usdt: string;
  }[]) {
    const cur = forfeit.get(l.user_id) ?? 0n;
    const d = toMicros(l.amount_usdt);
    forfeit.set(l.user_id, l.type === "FORFEIT" ? cur + d : cur - d);
  }
  const confirmed = new Map(
    ((emailRows ?? []) as { id: string; confirmed: boolean }[]).map((e) => [
      e.id,
      e.confirmed,
    ]),
  );

  return rows.map((r) => {
    const net = forfeit.get(r.id) ?? 0n;
    return {
      userId: r.id,
      fullName: r.full_name,
      email: r.email,
      publicId: r.public_id,
      accountStatus: r.account_status,
      banReason: r.ban_reason,
      isAdmin: r.is_admin === true,
      forfeitedUsdt: fromMicros(net > 0n ? net : 0n),
      createdAt: r.created_at,
      kycStatus: r.kyc_status,
      emailConfirmed: confirmed.get(r.id) ?? false,
    };
  });
}

export const ACCOUNTS_PAGE_SIZE = 20;

/**
 * A page of accounts for the admin management table, newest first, with an
 * optional text filter (email / name / HabeshaP2P ID). Service-role read; the
 * caller must already be an admin. Returns the rows plus the total count for
 * pagination.
 */
export async function fetchAccountsPage(opts: {
  page: number;
  pageSize?: number;
  query?: string;
}): Promise<{ rows: AccountRow[]; total: number; page: number; pageSize: number }> {
  const admin = createAdminSupabase();
  const pageSize = Math.min(Math.max(opts.pageSize ?? ACCOUNTS_PAGE_SIZE, 1), 100);
  const page = Math.max(1, Math.floor(opts.page || 1));
  const from = (page - 1) * pageSize;

  let qb = admin
    .from("users")
    .select(
      "id, full_name, email, public_id, account_status, ban_reason, is_admin, created_at, kyc_status",
      { count: "exact" },
    );

  const q = (opts.query ?? "").trim();
  if (q.length >= 2) {
    const like = `%${q.replace(/[%_,()]/g, "")}%`;
    const ors = [`email.ilike.${like}`, `full_name.ilike.${like}`];
    if (/^\d+$/.test(q)) ors.push(`public_id.eq.${q}`);
    if (/^[0-9a-f-]{36}$/i.test(q)) ors.push(`id.eq.${q}`);
    qb = qb.or(ors.join(","));
  }

  const { data, count, error } = await qb
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw new Error(`failed to load accounts: ${error.message}`);

  return {
    rows: await toAccountRows(admin, (data ?? []) as RawUser[]),
    total: count ?? 0,
    page,
    pageSize,
  };
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
