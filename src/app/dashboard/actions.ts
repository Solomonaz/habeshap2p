"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { toMicros } from "@/lib/money";
import { postBond, releaseBond } from "@/lib/merchant";
import { requestWithdrawal } from "@/lib/withdrawals";
import { isLivePaymentsEnabled } from "@/lib/settings";

export type MerchantState = { error?: string };

export type WithdrawState = { error?: string; ok?: boolean };

/**
 * DEV-ONLY faucet: credits the signed-in user's wallet with test USDT so the
 * escrow flow can be exercised end-to-end before the Tron deposit integration
 * (Phase 7) exists. Hard-guarded to non-production environments — in prod the
 * only path to a credit is a confirmed on-chain deposit.
 *
 * RISK FLAG: this mints balance out of thin air. It MUST never ship enabled.
 * TWO gates: it is hard-blocked in production builds (NODE_ENV), AND it is
 * blocked whenever the admin has switched the platform to LIVE payments mode
 * (migration 0018) — in LIVE mode the only credit path is a confirmed on-chain
 * deposit, never a mint.
 */
export async function devFaucet(formData: FormData): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("faucet is disabled in production");
  }
  if (await isLivePaymentsEnabled()) {
    throw new Error("faucet is disabled while live payments mode is on");
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const raw = (formData.get("amount") ?? "").toString().trim();
  const amount = raw === "" ? "1000" : raw;
  // Validates the decimal shape and rejects non-positive values.
  if (toMicros(amount) <= 0n) {
    throw new Error("faucet amount must be positive");
  }

  const admin = createAdminSupabase();
  const { error } = await admin.rpc("ledger_deposit", {
    p_user: user.id,
    p_amount: amount,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
}

/**
 * Post a merchant collateral bond from the signed-in user's available balance.
 * The bond is held in escrow (rule #5); crossing the minimum (500 USDT) makes
 * the user a merchant with an uncapped trade limit. The SQL re-checks the
 * balance — we only authenticate the actor and validate the amount shape here.
 */
export async function postBondAction(
  _prev: MerchantState,
  formData: FormData,
): Promise<MerchantState> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const amount = (formData.get("amount") ?? "").toString().trim();
  try {
    if (toMicros(amount) <= 0n) {
      return { error: "Bond amount must be positive." };
    }
  } catch {
    return { error: "Enter a valid USDT amount." };
  }

  try {
    await postBond(user.id, amount);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to post bond." };
  }

  revalidatePath("/dashboard");
  return {};
}

/**
 * Release the entire bond back to available and drop merchant status. Fails (in
 * SQL) if the user still has live orders.
 */
export async function releaseBondAction(
  _prev: MerchantState,
  _formData: FormData,
): Promise<MerchantState> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  try {
    await releaseBond(user.id);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to release bond.",
    };
  }

  revalidatePath("/dashboard");
  return {};
}

/**
 * Request an on-chain withdrawal. Holds the funds (available →
 * usdt_withdraw_locked) and queues the request; whether it needs admin approval
 * is decided in SQL from the threshold (≥500 USDT). We only authenticate the
 * actor and validate the amount/address shape — the SQL re-checks the balance
 * and is the authoritative gate. The hot-wallet key is never touched here; only
 * the cron signer broadcasts (rule #6).
 */
export async function requestWithdrawalAction(
  _prev: WithdrawState,
  formData: FormData,
): Promise<WithdrawState> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const amount = (formData.get("amount") ?? "").toString().trim();
  const toAddress = (formData.get("toAddress") ?? "").toString().trim();

  if (!toAddress) {
    return { error: "Enter a destination address." };
  }
  try {
    if (toMicros(amount) <= 0n) {
      return { error: "Withdrawal amount must be positive." };
    }
  } catch {
    return { error: "Enter a valid USDT amount." };
  }

  try {
    await requestWithdrawal({ userId: user.id, toAddress, amount });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to request withdrawal.",
    };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
