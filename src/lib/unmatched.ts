import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * Admin reconciliation of pooled deposits that matched no intent (migration 0036).
 * The poller records each into `unmatched_deposits`; an admin credits it to a user
 * or ignores it. Service-role reads/writes — the caller must already be an admin
 * (the route gates it, the action re-checks, and the RPCs re-check is_admin).
 */
export type UnmatchedDeposit = {
  id: string;
  txHash: string;
  toAddress: string;
  amountUsdt: string;
  createdAt: string;
  /** A best-effort guess at the owner, from a nearby recent deposit intent. */
  suggested: { userId: string; email: string | null; intentAmount: string } | null;
};

export async function fetchUnmatchedDeposits(): Promise<UnmatchedDeposit[]> {
  const admin = createAdminSupabase();
  const { data: rows, error } = await admin
    .from("unmatched_deposits")
    .select("id, tx_hash, to_address, amount_usdt::text, created_at")
    .eq("status", "PENDING")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`failed to load unmatched deposits: ${error.message}`);
  }
  const list = (rows ?? []) as {
    id: string;
    tx_hash: string;
    to_address: string;
    amount_usdt: string;
    created_at: string;
  }[];
  if (list.length === 0) return [];

  // Suggest a likely owner: a deposit intent from the last day whose amount is
  // within ~1.5 USDT (covers decimal truncation and a typical ~1 USDT exchange fee).
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { data: intents } = await admin
    .from("deposit_intents")
    .select("user_id, amount_usdt::text, created_at")
    .gte("created_at", dayAgo);
  const intentRows = (intents ?? []) as {
    user_id: string;
    amount_usdt: string;
  }[];

  const userIds = [...new Set(intentRows.map((i) => i.user_id))];
  const emailById = new Map<string, string | null>();
  if (userIds.length) {
    const { data: users } = await admin
      .from("users")
      .select("id, email")
      .in("id", userIds);
    for (const u of (users ?? []) as { id: string; email: string | null }[]) {
      emailById.set(u.id, u.email);
    }
  }

  return list.map((r) => {
    const amt = Number(r.amount_usdt);
    let best: { user_id: string; amount_usdt: string } | null = null;
    let bestDiff = Infinity;
    for (const i of intentRows) {
      const d = Math.abs(Number(i.amount_usdt) - amt);
      if (d <= 1.5 && d < bestDiff) {
        best = i;
        bestDiff = d;
      }
    }
    return {
      id: r.id,
      txHash: r.tx_hash,
      toAddress: r.to_address,
      amountUsdt: r.amount_usdt,
      createdAt: r.created_at,
      suggested: best
        ? {
            userId: best.user_id,
            email: emailById.get(best.user_id) ?? null,
            intentAmount: best.amount_usdt,
          }
        : null,
    };
  });
}

/** Admin credits a stuck transfer to a user. Returns the credited amount. */
export async function creditUnmatchedDeposit(args: {
  txHash: string;
  userId: string;
  adminId: string;
}): Promise<string> {
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("credit_unmatched_deposit", {
    p_admin: args.adminId,
    p_tx_hash: args.txHash,
    p_user: args.userId,
  });
  if (error) throw new Error(error.message);
  return String(data ?? "0");
}

/** Admin dismisses a stuck transfer (dust / not a real deposit), with a reason. */
export async function ignoreUnmatchedDeposit(args: {
  txHash: string;
  adminId: string;
  reason?: string;
}): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("ignore_unmatched_deposit", {
    p_admin: args.adminId,
    p_tx_hash: args.txHash,
    p_reason: args.reason ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Send an ignored row back to the pending queue (recover a mistaken ignore). */
export async function unignoreUnmatchedDeposit(args: {
  txHash: string;
  adminId: string;
}): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin.rpc("unignore_unmatched_deposit", {
    p_admin: args.adminId,
    p_tx_hash: args.txHash,
  });
  if (error) throw new Error(error.message);
}

export type ResolvedUnmatchedDeposit = {
  id: string;
  txHash: string;
  amountUsdt: string;
  status: "CREDITED" | "IGNORED";
  creditedEmail: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
};

/** The CREDITED + IGNORED history, newest resolution first. */
export async function fetchResolvedUnmatchedDeposits(): Promise<
  ResolvedUnmatchedDeposit[]
> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("unmatched_deposits")
    .select(
      "id, tx_hash, amount_usdt::text, status, credited_user_id, resolution_note, resolved_at",
    )
    .in("status", ["CREDITED", "IGNORED"])
    .order("resolved_at", { ascending: false })
    .limit(100);
  if (error) {
    throw new Error(`failed to load resolved deposits: ${error.message}`);
  }
  const rows = (data ?? []) as {
    id: string;
    tx_hash: string;
    amount_usdt: string;
    status: "CREDITED" | "IGNORED";
    credited_user_id: string | null;
    resolution_note: string | null;
    resolved_at: string | null;
  }[];

  const creditedIds = [
    ...new Set(rows.map((r) => r.credited_user_id).filter(Boolean) as string[]),
  ];
  const emailById = new Map<string, string | null>();
  if (creditedIds.length) {
    const { data: users } = await admin
      .from("users")
      .select("id, email")
      .in("id", creditedIds);
    for (const u of (users ?? []) as { id: string; email: string | null }[]) {
      emailById.set(u.id, u.email);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    txHash: r.tx_hash,
    amountUsdt: r.amount_usdt,
    status: r.status,
    creditedEmail: r.credited_user_id
      ? (emailById.get(r.credited_user_id) ?? null)
      : null,
    resolutionNote: r.resolution_note,
    resolvedAt: r.resolved_at,
  }));
}

/** Resolve an email to a user id (for the manual-credit form). */
export async function resolveUserByEmail(email: string): Promise<string | null> {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("users")
    .select("id")
    .ilike("email", email.trim())
    .maybeSingle();
  return data?.id ?? null;
}
