"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { resolveDispute } from "@/lib/disputes";
import { approveWithdrawal, rejectWithdrawal } from "@/lib/withdrawals";
import { approveKyc, rejectKyc } from "@/lib/kyc";
import { recordAdminAction } from "@/lib/audit";
import { setLivePayments } from "@/lib/settings";
import { isTronConfigured } from "@/lib/env";
import { DISPUTE_RESOLUTIONS } from "@/types/domain";

const schema = z.object({
  disputeId: z.string().uuid(),
  resolution: z.enum(DISPUTE_RESOLUTIONS),
});

export type ResolveState = { error?: string };

/**
 * Admin dispute ruling. Authorization is checked THREE times: the /admin route
 * guard, here (re-fetch is_admin for the authenticated user), and again inside
 * the SQL function (`dispute_resolve` re-checks is_admin). The SQL is the real
 * gate; the earlier checks just fail fast and keep the UI honest.
 */
export async function resolveDisputeAction(
  _prev: ResolveState,
  formData: FormData,
): Promise<ResolveState> {
  const parsed = schema.safeParse({
    disputeId: formData.get("disputeId"),
    resolution: formData.get("resolution"),
  });
  if (!parsed.success) return { error: "Invalid request" };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Not authorized" };
  }

  try {
    await resolveDispute({
      disputeId: parsed.data.disputeId,
      adminId: user.id,
      resolution: parsed.data.resolution,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Resolution failed" };
  }

  // Audit the ruling (best-effort; never masks the resolution above).
  await recordAdminAction({
    adminId: user.id,
    action: "dispute_resolve",
    targetType: "dispute",
    targetId: parsed.data.disputeId,
    detail: `resolved ${parsed.data.resolution}`,
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/disputes/${parsed.data.disputeId}`);
  return {};
}

const withdrawalSchema = z.object({
  withdrawalId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export type WithdrawalReviewState = { error?: string };

/**
 * Admin clears a pending withdrawal to send. Authorization is checked THREE
 * times: the /admin route guard, here (re-fetch is_admin), and again in the SQL
 * (`withdrawal_approve` re-checks is_admin). The signer cron broadcasts it; this
 * only flips PENDING_APPROVAL → APPROVED.
 */
export async function approveWithdrawalAction(
  _prev: WithdrawalReviewState,
  formData: FormData,
): Promise<WithdrawalReviewState> {
  const parsed = withdrawalSchema.safeParse({
    withdrawalId: formData.get("withdrawalId"),
  });
  if (!parsed.success) return { error: "Invalid request" };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Not authorized" };
  }

  try {
    await approveWithdrawal(parsed.data.withdrawalId, user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Approval failed" };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "withdrawal_approve",
    targetType: "withdrawal",
    targetId: parsed.data.withdrawalId,
  });

  revalidatePath("/admin/withdrawals");
  return {};
}

/**
 * Admin denies a pending withdrawal; the SQL refunds the held funds back to the
 * user's available balance. Same triple authorization as approve.
 */
export async function rejectWithdrawalAction(
  _prev: WithdrawalReviewState,
  formData: FormData,
): Promise<WithdrawalReviewState> {
  const parsed = withdrawalSchema.safeParse({
    withdrawalId: formData.get("withdrawalId"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) return { error: "Invalid request" };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Not authorized" };
  }

  const reason = parsed.data.reason?.trim() || "Rejected by admin";
  try {
    await rejectWithdrawal(parsed.data.withdrawalId, user.id, reason);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Rejection failed" };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "withdrawal_reject",
    targetType: "withdrawal",
    targetId: parsed.data.withdrawalId,
    detail: reason,
  });

  revalidatePath("/admin/withdrawals");
  return {};
}

const paymentsModeSchema = z.object({
  // Checkbox/hidden field: "on" → go live, anything else → test mode.
  enabled: z.enum(["true", "false"]),
});

export type PaymentsModeState = { error?: string; ok?: boolean };

/**
 * Flip the platform between TEST (dev faucet + stub chain) and LIVE (real
 * on-chain money) mode. Same triple authorization as every other admin action
 * (route guard, re-check here, and the SQL `set_live_payments` re-checks
 * is_admin). Enabling LIVE additionally refuses unless the Tron secrets are
 * configured — so an admin can never strand the platform in a live mode whose
 * provider can't actually move money.
 */
export async function setPaymentsModeAction(
  _prev: PaymentsModeState,
  formData: FormData,
): Promise<PaymentsModeState> {
  const parsed = paymentsModeSchema.safeParse({
    enabled: formData.get("enabled"),
  });
  if (!parsed.success) return { error: "Invalid request" };
  const enabling = parsed.data.enabled === "true";

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Not authorized" };
  }

  if (enabling && !isTronConfigured()) {
    return {
      error:
        "Can't enable live payments: the Tron provider isn't configured. Set " +
        "TRON_API_KEY, TRON_HOT_WALLET_ADDRESS, TRON_HOT_WALLET_PRIVATE_KEY and " +
        "TRON_DEPOSIT_MNEMONIC on the server first.",
    };
  }

  try {
    await setLivePayments(user.id, enabling);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not change mode" };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "payments_mode_set",
    targetType: "platform_settings",
    detail: enabling ? "live payments ENABLED" : "live payments DISABLED",
  });

  revalidatePath("/admin/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}

const kycSchema = z.object({
  submissionId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export type KycReviewState = { error?: string };

/**
 * Admin clears a pending identity submission; the account becomes APPROVED and
 * the database triggers (migration 0015) stop blocking that user's trades. Same
 * triple authorization as the other admin actions (route guard, here, and SQL).
 */
export async function approveKycAction(
  _prev: KycReviewState,
  formData: FormData,
): Promise<KycReviewState> {
  const parsed = kycSchema.safeParse({
    submissionId: formData.get("submissionId"),
  });
  if (!parsed.success) return { error: "Invalid request" };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Not authorized" };
  }

  try {
    await approveKyc(parsed.data.submissionId, user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Approval failed" };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "kyc_approve",
    targetType: "kyc_submission",
    targetId: parsed.data.submissionId,
  });

  revalidatePath("/admin/kyc");
  return {};
}

/** Admin denies a pending submission; the user may resubmit. */
export async function rejectKycAction(
  _prev: KycReviewState,
  formData: FormData,
): Promise<KycReviewState> {
  const parsed = kycSchema.safeParse({
    submissionId: formData.get("submissionId"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) return { error: "Invalid request" };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Not authorized" };
  }

  const reason = parsed.data.reason?.trim() || "Rejected by admin";
  try {
    await rejectKyc(parsed.data.submissionId, user.id, reason);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Rejection failed" };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "kyc_reject",
    targetType: "kyc_submission",
    targetId: parsed.data.submissionId,
    detail: reason,
  });

  revalidatePath("/admin/kyc");
  return {};
}
