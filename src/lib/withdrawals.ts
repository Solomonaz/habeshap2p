import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { toMicros, fromMicros, formatUsdt } from "@/lib/money";
import { getChainProvider, WITHDRAWAL_APPROVAL_THRESHOLD } from "@/lib/chain";
import { getWithdrawalFee } from "@/lib/settings";
import { createNotification } from "@/lib/notifications";
import { isValidTronAddress } from "@/lib/chain/address";

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
  // Reject malformed destinations up front so funds are never held for a payout
  // that can only fail at signing time. Full base58check validation (not just
  // the "T…34 chars" shape) so stub/look-alike addresses are caught here.
  if (!isValidTronAddress(args.toAddress)) {
    throw new Error("enter a valid Tron (TRC-20) address");
  }
  // The fee is authoritative server-side (never trusted from the client) and is
  // baked onto the row at request time, so a later admin change doesn't alter an
  // already-queued withdrawal. Reject amounts that don't clear the fee up front.
  const fee = await getWithdrawalFee();
  if (toMicros(args.amount) <= toMicros(fee)) {
    throw new Error(
      `amount must be greater than the ${formatUsdt(fee)} USDT withdrawal fee`,
    );
  }
  const supabase = createAdminSupabase();
  const { data, error } = await supabase.rpc("withdrawal_request", {
    p_user: args.userId,
    p_to_address: args.toAddress,
    p_amount: args.amount,
    p_threshold: String(WITHDRAWAL_APPROVAL_THRESHOLD),
    p_fee: fee,
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
  "id, user_id, to_address, amount_usdt::text, fee_usdt::text, status, tx_hash, reviewed_by, failure_reason, created_at, reviewed_at, sent_at, confirmed_at";

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
  /**
   * Rows left parked in SENDING because bookkeeping failed around the broadcast —
   * they need a human to reconcile (and must NEVER be auto-retried). A non-zero
   * value here is an operational alarm, not routine.
   */
  stuck: number;
};

/**
 * Signer worker (cron): broadcast every APPROVED withdrawal and advance any SENT
 * ones to CONFIRMED.
 *
 * At-most-once payout via a CLAIM (migration 0031). For each APPROVED row we first
 * atomically claim it (APPROVED → SENDING); only the runner that wins the claim
 * broadcasts, so two overlapping runs can never both pay the same withdrawal. Then:
 *
 *   • broadcast succeeds      → mark SENT (funds debited).
 *   • broadcast THROWS        → mark FAILED (funds refunded) — safe, nothing left.
 *   • broadcast OK but the SENT bookkeeping fails → the row stays SENDING and is
 *     surfaced (`stuck`) for manual reconciliation. We must NOT refund (the USDT is
 *     already gone) and must NOT retry (that double-sends).
 *
 * The crucial invariant: once `sendUsdt` returns successfully we never take the
 * refund path. Every attempt is logged (rule #6) — without secrets.
 *
 * Callers should run this under the process-withdrawals cron lock so claims rarely
 * even contend; the claim is the correctness guarantee, the lock is hygiene.
 */
export async function processApprovedWithdrawals(): Promise<WithdrawalProcessResult> {
  const supabase = createAdminSupabase();
  const provider = await getChainProvider();

  const { data: approved, error } = await supabase
    .from("withdrawals")
    .select("id, user_id, to_address, amount_usdt::text, fee_usdt::text")
    .eq("status", "APPROVED")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to load approved withdrawals: ${error.message}`);

  let sent = 0;
  let failed = 0;
  let stuck = 0;
  for (const w of (approved ?? []) as {
    id: string;
    user_id: string;
    to_address: string;
    amount_usdt: string;
    fee_usdt: string;
  }[]) {
    // The user receives the NET (gross amount minus the fee); the fee is retained
    // as platform revenue by withdrawal_mark_sent. Send the net on-chain.
    const netUsdt = fromMicros(toMicros(w.amount_usdt) - toMicros(w.fee_usdt));
    // 1. CLAIM atomically (APPROVED → SENDING). A row already taken by a concurrent
    //    run (or no longer APPROVED) returns false → skip without broadcasting. A
    //    claim error leaves the row APPROVED for the next run.
    let claimed = false;
    try {
      const { data, error: clErr } = await supabase.rpc(
        "withdrawal_claim_for_send",
        { p_id: w.id },
      );
      if (clErr) throw new Error(clErr.message);
      claimed = data === true;
    } catch (e) {
      console.error(
        `[withdrawal-signer] could not claim ${w.id}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      continue;
    }
    if (!claimed) continue;

    // Audit log of the signing attempt — never include keys or full addresses.
    console.info(
      `[withdrawal-signer] broadcasting ${w.id} net=${netUsdt} fee=${w.fee_usdt} ` +
        `to=${w.to_address.slice(0, 6)}… network=${provider.network}`,
    );

    // 2. BROADCAST the NET. A throw here means the funds NEVER left → refund is safe.
    let txHash: string;
    try {
      ({ txHash } = await provider.sendUsdt(w.to_address, netUsdt));
    } catch (e) {
      const reason = e instanceof Error ? e.message : "broadcast failed";
      console.error(`[withdrawal-signer] broadcast FAILED ${w.id}: ${reason}`);
      const { error: fErr } = await supabase.rpc("withdrawal_mark_failed", {
        p_id: w.id,
        p_reason: reason,
      });
      if (fErr) {
        // The refund itself failed; the row is left SENDING. It did NOT broadcast,
        // so it is safe to refund by hand later, but we never auto-touch a SENDING
        // row — flag it for reconciliation.
        stuck += 1;
        console.error(
          `[withdrawal-signer] could not refund ${w.id} after a failed ` +
            `broadcast: ${fErr.message} — left SENDING for manual reconciliation`,
        );
      } else {
        failed += 1;
      }
      continue;
    }

    // 3. POINT OF NO RETURN: the broadcast succeeded, the funds are gone. From here
    //    we must NEVER refund. If the SENT bookkeeping fails, park the row in
    //    SENDING and alarm — a human reconciles it; auto-retry would double-send.
    const { error: sErr } = await supabase.rpc("withdrawal_mark_sent", {
      p_id: w.id,
      p_tx_hash: txHash,
    });
    if (sErr) {
      stuck += 1;
      // Best-effort: stamp the broadcast hash onto the parked row so the admin
      // reconciliation screen can show it (and the operator can confirm it landed
      // on-chain) without digging through logs. Scoped to the still-SENDING row in
      // SQL so it can't disturb a row another path already settled. If this also
      // fails, the hash is still in the log line below.
      const { error: stampErr } = await supabase.rpc("withdrawal_stamp_send_tx", {
        p_id: w.id,
        p_tx_hash: txHash,
      });
      if (stampErr) {
        console.error(
          `[withdrawal-signer] could not stamp tx on ${w.id}: ${stampErr.message}`,
        );
      }
      console.error(
        `[withdrawal-signer] CRITICAL: ${w.id} broadcast tx=${txHash} but ` +
          `mark_sent failed: ${sErr.message}. Left SENDING — reconcile by hand, ` +
          `DO NOT auto-retry.`,
      );
      continue;
    }
    sent += 1;
    console.info(`[withdrawal-signer] sent ${w.id} tx=${txHash}`);
    await createNotification({
      userId: w.user_id,
      type: "withdrawal_sent",
      title: "Withdrawal sent",
      body:
        `${formatUsdt(netUsdt)} USDT sent on-chain` +
        (toMicros(w.fee_usdt) > 0n ? ` (after ${formatUsdt(w.fee_usdt)} fee)` : "") +
        ` — awaiting confirmation.`,
      href: "/dashboard",
    });
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

  return { sent, failed, confirmed, stuck };
}

/**
 * Withdrawals parked in SENDING — the signer claimed and (in the dangerous case)
 * broadcast them, but the SENT/FAILED bookkeeping didn't complete. They are NOT
 * auto-processed (that risks a double-send), so an admin must reconcile each
 * against the chain. Service-role read; oldest first. A non-empty list is an alarm.
 */
export async function fetchStuckWithdrawals(): Promise<WithdrawalRow[]> {
  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("withdrawals")
    .select(WITHDRAWAL_COLUMNS)
    .eq("status", "SENDING")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to load in-flight withdrawals: ${error.message}`);
  return (data ?? []) as WithdrawalRow[];
}

/**
 * Admin resolves a stuck (SENDING) withdrawal as actually sent — the operator
 * verified the transfer on-chain. Debits the hold and records it, exactly like the
 * signer's own mark_sent. SQL re-checks is_admin. Requires the verified tx hash.
 */
export async function reconcileWithdrawalSent(
  id: string,
  adminId: string,
  txHash: string,
): Promise<void> {
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("withdrawal_reconcile_sent", {
    p_id: id,
    p_admin: adminId,
    p_tx_hash: txHash,
  });
  if (error) throw new Error(error.message);
}

/**
 * Admin resolves a stuck (SENDING) withdrawal as never sent — the operator
 * confirmed no transfer landed on-chain. Refunds the held funds and marks it
 * FAILED. SQL re-checks is_admin.
 */
export async function reconcileWithdrawalRefund(
  id: string,
  adminId: string,
  reason: string,
): Promise<void> {
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("withdrawal_reconcile_refund", {
    p_id: id,
    p_admin: adminId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}
