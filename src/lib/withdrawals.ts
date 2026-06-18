import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { toMicros } from "@/lib/money";
import { getChainProvider, WITHDRAWAL_APPROVAL_THRESHOLD } from "@/lib/chain";

export type WithdrawalRow = Database["public"]["Tables"]["withdrawals"]["Row"];

/**
 * Withdrawal side of the on-chain ramp (Phase 7).
 *
 * Lifecycle (all money moves happen in the SQL functions of migration 0012):
 *   request  → funds held (available → usdt_withdraw_locked); PENDING_APPROVAL
 *              if amount ≥ threshold, else APPROVED
 *   approve/reject → admin clears or denies a pending request
 *   signer   → broadcasts APPROVED withdrawals, marks SENT (funds burned) or
 *              FAILED (held funds refunded); later marks CONFIRMED
 *
 * RULE #6: the signer (processApprovedWithdrawals) is the ONLY thing that calls
 * the chain provider's sendUsdt, runs server-side from the secret store, and
 * logs every signing attempt. It must only be reachable from a secret-guarded
 * cron route — never from a user-facing action.
 */

/**
 * Request a withdrawal. Holds the funds and queues it; whether it needs admin
 * approval is decided in SQL from the threshold. The amount is validated through
 * toMicros so a malformed value fails before hitting the database.
 */
export async function requestWithdrawal(args: {
  userId: string;
  toAddress: string;
  amount: string;
}): Promise<string> {
  if (toMicros(args.amount) <= 0n) {
    throw new Error("withdrawal amount must be positive");
  }
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("withdrawal_request", {
    p_user: args.userId,
    p_to_address: args.toAddress,
    p_amount: args.amount,
    p_threshold: String(WITHDRAWAL_APPROVAL_THRESHOLD),
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("withdrawal_request returned no id");
  return data;
}

/** Admin clears a pending withdrawal to send. SQL re-checks is_admin. */
export async function approveWithdrawal(
  id: string,
  adminId: string,
): Promise<void> {
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("withdrawal_approve", {
    p_id: id,
    p_admin: adminId,
  });
  if (error) throw new Error(error.message);
}

/** Admin denies a pending withdrawal; held funds are refunded in SQL. */
export async function rejectWithdrawal(
  id: string,
  adminId: string,
  reason: string,
): Promise<void> {
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("withdrawal_reject", {
    p_id: id,
    p_admin: adminId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

const WITHDRAWAL_COLUMNS =
  "id, user_id, to_address, amount_usdt::text, status, tx_hash, reviewed_by, failure_reason, created_at, reviewed_at, sent_at, confirmed_at";

/** A user's own withdrawals (RLS session client), newest first. */
export async function fetchWithdrawalsForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<WithdrawalRow[]> {
  const { data, error } = await supabase
    .from("withdrawals")
    .select(WITHDRAWAL_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`failed to load withdrawals: ${error.message}`);
  return (data ?? []) as WithdrawalRow[];
}

/**
 * Admin queue of withdrawals awaiting approval (service-role read; caller must
 * have already verified the user is an admin), oldest first.
 */
export async function fetchPendingWithdrawals(): Promise<WithdrawalRow[]> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("withdrawals")
    .select(WITHDRAWAL_COLUMNS)
    .eq("status", "PENDING_APPROVAL")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to load withdrawals: ${error.message}`);
  return (data ?? []) as WithdrawalRow[];
}

export type WithdrawalProcessResult = {
  sent: number;
  failed: number;
  confirmed: number;
};

/**
 * Signer worker (cron): broadcast every APPROVED withdrawal and advance any SENT
 * ones to CONFIRMED.
 *
 * For each APPROVED row we call the chain provider's sendUsdt and then mark the
 * row SENT (funds burned) on success or FAILED (funds refunded) on error. Every
 * attempt is logged (rule #6: "log every signing op") — without secrets.
 */
export async function processApprovedWithdrawals(): Promise<WithdrawalProcessResult> {
  const supabase = createAdminSupabase();
  const provider = getChainProvider();

  const { data: approved, error } = await supabase
    .from("withdrawals")
    .select("id, to_address, amount_usdt::text")
    .eq("status", "APPROVED")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to load approved withdrawals: ${error.message}`);

  let sent = 0;
  let failed = 0;
  for (const w of (approved ?? []) as {
    id: string;
    to_address: string;
    amount_usdt: string;
  }[]) {
    // Audit log of the signing attempt — never include keys or full addresses.
    console.info(
      `[withdrawal-signer] broadcasting ${w.id} amount=${w.amount_usdt} ` +
        `to=${w.to_address.slice(0, 6)}… network=${provider.network}`,
    );
    try {
      const { txHash } = await provider.sendUsdt(w.to_address, w.amount_usdt);
      const { error: sErr } = await supabase.rpc("withdrawal_mark_sent", {
        p_id: w.id,
        p_tx_hash: txHash,
      });
      if (sErr) throw new Error(sErr.message);
      sent += 1;
      console.info(`[withdrawal-signer] sent ${w.id} tx=${txHash}`);
    } catch (e) {
      const reason = e instanceof Error ? e.message : "broadcast failed";
      console.error(`[withdrawal-signer] FAILED ${w.id}: ${reason}`);
      // Refund the held funds. If this itself errors, leave the row APPROVED for
      // the next run rather than risk a double state change.
      const { error: fErr } = await supabase.rpc("withdrawal_mark_failed", {
        p_id: w.id,
        p_reason: reason,
      });
      if (fErr) {
        console.error(
          `[withdrawal-signer] could not mark ${w.id} failed: ${fErr.message}`,
        );
      } else {
        failed += 1;
      }
    }
  }

  // Advance broadcast withdrawals to CONFIRMED once the chain confirms them.
  const { data: pendingConfirm, error: pErr } = await supabase
    .from("withdrawals")
    .select("id, tx_hash")
    .eq("status", "SENT");
  if (pErr) throw new Error(`failed to load sent withdrawals: ${pErr.message}`);

  let confirmed = 0;
  for (const w of (pendingConfirm ?? []) as {
    id: string;
    tx_hash: string | null;
  }[]) {
    if (!w.tx_hash) continue;
    if (await provider.isConfirmed(w.tx_hash)) {
      const { error: cErr } = await supabase.rpc("withdrawal_mark_confirmed", {
        p_id: w.id,
      });
      if (cErr) throw new Error(cErr.message);
      confirmed += 1;
    }
  }

  return { sent, failed, confirmed };
}
