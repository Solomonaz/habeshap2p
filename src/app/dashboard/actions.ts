"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { toMicros, formatUsdt } from "@/lib/money";
import { postBond, releaseBond } from "@/lib/merchant";
import { requestWithdrawal } from "@/lib/withdrawals";
import { internalTransfer, lookupUserByPublicId } from "@/lib/transfers";
import { notifyAdmins, createNotification } from "@/lib/notifications";
import { isLivePaymentsEnabled } from "@/lib/settings";
import {
  createPooledDepositIntent,
  claimPooledDepositByHash,
  type PooledDepositIntent,
} from "@/lib/deposits";

export type MerchantState = { error?: string };

export type DisplayNameState = {
  error?: string;
  ok?: string;
  /** The saved nickname, or null when cleared — lets the form sync its display. */
  value?: string | null;
};

/**
 * Set (or clear) the signed-in user's marketplace nickname (migration 0062). The
 * SQL RPC is the authoritative gate: it enforces KYC-verified-only, uniqueness,
 * the reserved-word block, and the format, and raises a friendly message we pass
 * straight through. We only authenticate the actor and pin p_user to THEIR id —
 * the RPC is service-role only precisely so no client can rename another account.
 * An empty value clears the nickname (public display reverts to the legal name).
 */
export async function setDisplayNameAction(
  _prev: DisplayNameState,
  formData: FormData,
): Promise<DisplayNameState> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = (formData.get("display_name") ?? "").toString();
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("set_display_name", {
    p_user: user.id,
    p_name: name,
  });
  if (error) {
    return { error: error.message || "Could not save your display name." };
  }
  // Revalidate the surfaces the nickname shows on so it updates immediately.
  revalidatePath("/dashboard");
  revalidatePath("/market");
  return {
    ok: data ? "Display name saved." : "Display name cleared.",
    value: (data as string | null) ?? null,
  };
}

/**
 * Live availability/format check for the nickname field (read-only). Returns a
 * short status: 'ok', 'empty', 'short', 'long', 'chars', 'reserved', 'taken'.
 * Drives the inline ✓/✗ hint as the user types; the authoritative validation is
 * still setDisplayNameAction on submit.
 */
export async function checkDisplayNameAction(
  name: string,
): Promise<{ status: string }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "empty" };
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("display_name_status", {
    p_user: user.id,
    p_name: name,
  });
  if (error) return { status: "error" };
  return { status: (data as string) ?? "error" };
}

export type WithdrawState = { error?: string; ok?: boolean };

export type DepositIntentState = {
  error?: string;
  intent?: PooledDepositIntent;
};

export type ClaimTxState = {
  error?: string;
  success?: string;
};


/**
 * Create a pooled/omnibus deposit intent (migration 0029): reserve a unique exact
 * amount the user must send to the shared address, so the poller can attribute the
 * transfer back to them. Only used when the sweep strategy is 'pooled'. We just
 * authenticate the actor and validate the amount shape; the RPC allocates the
 * unique fingerprint.
 */
export async function createDepositIntentAction(
  _prev: DepositIntentState,
  formData: FormData,
): Promise<DepositIntentState> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const amount = (formData.get("amount") ?? "").toString().trim();
  try {
    if (toMicros(amount) <= 0n) {
      return { error: "Deposit amount must be positive." };
    }
  } catch {
    return { error: "Enter a valid USDT amount." };
  }

  try {
    const intent = await createPooledDepositIntent(user.id, amount);
    return { intent };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to create deposit request.",
    };
  }
}

/**
 * Self-service claim deposit by transaction hash.
 */
export async function claimDepositTxAction(
  _prev: ClaimTxState,
  formData: FormData,
): Promise<ClaimTxState> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const txHash = (formData.get("txHash") ?? "").toString().trim();
  if (!txHash) {
    return { error: "Please enter a transaction hash." };
  }

  try {
    const res = await claimPooledDepositByHash(user.id, txHash);
    if (res.status === "already_credited") {
      return { success: "This deposit was already credited to your account balance." };
    }
    if (res.status === "credited") {
      revalidatePath("/dashboard");
      return { success: "Deposit verified! Your balance has been credited." };
    }
    if (res.status === "pending") {
      return {
        error:
          "Your transaction was found on-chain, but the exact amount does not match your active intent. An administrator has been notified to manually reconcile your deposit.",
      };
    }
    return {
      error:
        "Transaction not found or not yet confirmed. Please verify the TxHash and ensure it has reached full network confirmation.",
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to verify transaction.",
    };
  }
}


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

  let needsApproval = false;
  try {
    ({ needsApproval } = await requestWithdrawal({
      userId: user.id,
      toAddress,
      amount,
    }));
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to request withdrawal.",
    };
  }

  // Large withdrawals are held for manual sign-off — alert the admins. The
  // send + fee (gross) is what crosses the threshold, decided in requestWithdrawal.
  if (needsApproval) {
    await notifyAdmins({
      type: "withdrawal_pending",
      title: "Withdrawal needs approval",
      body: `${formatUsdt(amount)} USDT is awaiting your sign-off.`,
      href: "/admin/withdrawals",
    });
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

export type TransferState = { error?: string; ok?: string };

/**
 * Look up a recipient by their HabeshaP2P ID so the sender can confirm the name
 * before sending. Read-only; returns the display name or an error. Requires a
 * signed-in user (no anonymous directory scraping).
 */
export async function lookupTransferRecipientAction(
  recipientId: string,
): Promise<{ name?: string; error?: string }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  if (recipientId.replace(/[^0-9]/g, "").length < 4) return {};
  const found = await lookupUserByPublicId(recipientId);
  if (!found) return { error: "No account with that HabeshaP2P ID." };
  if (found.id === user.id) return { error: "That's your own ID." };
  return { name: found.name };
}

/**
 * Send USDT to another user by HabeshaP2P ID — a free, instant, off-chain ledger
 * move. We authenticate the sender; the SQL enforces verification, funds, and the
 * self-send / unknown-ID / inactive-account checks.
 */
export async function internalTransferAction(
  _prev: TransferState,
  formData: FormData,
): Promise<TransferState> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const recipientId = (formData.get("recipientId") ?? "").toString().trim();
  const amount = (formData.get("amount") ?? "").toString().trim();

  if (!recipientId) return { error: "Enter the recipient's HabeshaP2P ID." };
  try {
    if (toMicros(amount) <= 0n) return { error: "Enter a positive amount." };
  } catch {
    return { error: "Enter a valid USDT amount." };
  }

  let recipientUserId: string;
  try {
    recipientUserId = await internalTransfer({
      senderId: user.id,
      recipientPublicId: recipientId,
      amount,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Transfer failed." };
  }

  // Tell the recipient (best-effort — the transfer already succeeded).
  try {
    const { data: me } = await createAdminSupabase()
      .from("users")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    const fromName = me?.full_name?.trim() || "another user";
    await createNotification({
      userId: recipientUserId,
      type: "transfer_received",
      title: "USDT received",
      body: `${formatUsdt(amount)} USDT from ${fromName}.`,
      href: "/dashboard",
    });
  } catch {
    /* notification is best-effort */
  }

  revalidatePath("/dashboard");
  return { ok: `Sent ${formatUsdt(amount)} USDT.` };
}
