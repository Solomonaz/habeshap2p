import "server-only";
import { createAdminSupabase } from "@/lib/supabase/server";
import { toMicros } from "@/lib/money";

/**
 * Server-side wrappers over the merchant-bond RPCs (migration 0011).
 *
 * Posting/releasing a bond moves real escrow value, so these go through the
 * service-role client and bypass RLS — call them only from trusted server code
 * (server actions) after authenticating the user. The SQL re-validates balances
 * and open-order state; never trust the client for the amount or the actor.
 *
 * The actor is always the AUTHENTICATED user from the session — a user can only
 * bond/unbond their OWN wallet, so there is no separate actor parameter to spoof.
 */

function assertValidAmount(amount: string): void {
  const micros = toMicros(amount); // throws on bad format / too many decimals
  if (micros <= 0n) {
    throw new Error(`bond amount must be positive: "${amount}"`);
  }
}

/**
 * Lock `amount` USDT from the user's available balance as a collateral bond.
 * Crossing MIN_MERCHANT_BOND promotes them to merchant (uncapped trade limit).
 */
export async function postBond(userId: string, amount: string): Promise<void> {
  assertValidAmount(amount);
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("merchant_post_bond", {
    p_user: userId,
    p_amount: amount,
  });
  if (error) throw new Error(error.message);
}

/**
 * Return the user's entire bond to their available balance and drop merchant
 * status. Fails in SQL if the user has any live order.
 */
export async function releaseBond(userId: string): Promise<void> {
  const supabase = createAdminSupabase();
  const { error } = await supabase.rpc("merchant_release_bond", {
    p_user: userId,
  });
  if (error) throw new Error(error.message);
}
