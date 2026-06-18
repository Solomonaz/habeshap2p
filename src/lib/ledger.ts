import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server";
import { toMicros } from "@/lib/money";

/**
 * Server-side wrapper over the ledger primitive RPCs (see migration 0005).
 *
 * These use the service-role client and therefore bypass RLS — call them only
 * from trusted server contexts (route handlers, server actions, cron, admin),
 * after you have authorised the operation. Never expose them to the client.
 *
 * Amounts are decimal strings. We validate them through toMicros() first so a
 * malformed amount fails here, before it ever reaches the database.
 */

function assertValidAmount(amount: string): void {
  const micros = toMicros(amount); // throws on bad format / too many decimals
  if (micros <= 0n) {
    throw new Error(`ledger amount must be positive: "${amount}"`);
  }
}

/** Credit a user's available balance after a confirmed on-chain deposit. */
export async function deposit(userId: string, amount: string): Promise<void> {
  assertValidAmount(amount);
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("ledger_deposit", {
    p_user: userId,
    p_amount: amount,
  });
  if (error) throw new Error(`ledger_deposit failed: ${error.message}`);
}

/** Move a user's funds from available to locked (escrow hold). */
export async function lock(
  userId: string,
  amount: string,
  orderId: string,
): Promise<void> {
  assertValidAmount(amount);
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("ledger_lock", {
    p_user: userId,
    p_amount: amount,
    p_order: orderId,
  });
  if (error) throw new Error(`ledger_lock failed: ${error.message}`);
}

/** Return locked funds to available (cancel / timer expiry). */
export async function unlock(
  userId: string,
  amount: string,
  orderId: string,
): Promise<void> {
  assertValidAmount(amount);
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("ledger_unlock", {
    p_user: userId,
    p_amount: amount,
    p_order: orderId,
  });
  if (error) throw new Error(`ledger_unlock failed: ${error.message}`);
}

/** Debit a user's available balance for an outgoing on-chain withdrawal. */
export async function withdraw(userId: string, amount: string): Promise<void> {
  assertValidAmount(amount);
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("ledger_withdraw", {
    p_user: userId,
    p_amount: amount,
  });
  if (error) throw new Error(`ledger_withdraw failed: ${error.message}`);
}
