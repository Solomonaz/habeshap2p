"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { createNotification } from "@/lib/notifications";
import { formatUsdt } from "@/lib/money";
import { resolveDispute } from "@/lib/disputes";
import { reinstateAccount } from "@/lib/accounts";
import {
  approveWithdrawal,
  rejectWithdrawal,
  reconcileWithdrawalSent,
  reconcileWithdrawalRefund,
} from "@/lib/withdrawals";
import { approveKyc, rejectKyc, isKycIdNumberTaken } from "@/lib/kyc";
import { recordAdminAction } from "@/lib/audit";
import {
  setLivePayments,
  setPlatformFee,
  setTradePolicy,
  setOrderTtlMinutes,
  setReleaseWindowMinutes,
  setWithdrawalFee,
  setSellerFee,
  setInternalTransferFee,
  setSweepStrategy,
  isLivePaymentsEnabled,
  type SweepStrategy,
} from "@/lib/settings";
import { getChainProvider } from "@/lib/chain";
import { isTronConfigured } from "@/lib/env";
import { toMicros } from "@/lib/money";
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

  // Notify both parties of the outcome (best-effort).
  try {
    const admin = createAdminSupabase();
    const { data: disp } = await admin
      .from("disputes")
      .select("order_id")
      .eq("id", parsed.data.disputeId)
      .maybeSingle();
    if (disp?.order_id) {
      const { data: order } = await admin
        .from("orders")
        .select("id, buyer_id, seller_id, amount_usdt::text")
        .eq("id", disp.order_id)
        .maybeSingle();
      if (order) {
        const forBuyer = parsed.data.resolution === "FAVOUR_BUYER";
        const amt = formatUsdt(order.amount_usdt);
        const href = `/orders/${order.id}`;
        await createNotification([
          {
            userId: forBuyer ? order.buyer_id : order.seller_id,
            type: "dispute_resolved",
            title: "Dispute resolved in your favour",
            body: `${amt} USDT — the ruling went your way.`,
            href,
          },
          {
            userId: forBuyer ? order.seller_id : order.buyer_id,
            type: "dispute_resolved",
            title: "Dispute resolved",
            body: `${amt} USDT — an admin ruled for the other party.`,
            href,
          },
        ]);
      }
    }
  } catch {
    /* notifications are best-effort */
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/disputes/${parsed.data.disputeId}`);
  return {};
}

const reinstateSchema = z.object({
  userId: z.string().uuid(),
  // The dispute we came from, so we can send the admin back to that record.
  disputeId: z.string().uuid().optional(),
});

export type ReinstateState = { error?: string; ok?: boolean; returned?: string };

/**
 * Admin appeal: reinstate a permanently-banned seller (e.g. they were banned
 * after a buyer falsely marked "paid", or had a legitimate reason for missing the
 * release window). Returns the funds the platform forfeited from them and flips
 * the account back to ACTIVE. Same triple authorization as every other admin
 * action: the /admin route guard, the re-check here, and the SQL
 * `account_reinstate` re-checks is_admin (and that the account is BANNED).
 */
export async function reinstateAccountAction(
  _prev: ReinstateState,
  formData: FormData,
): Promise<ReinstateState> {
  const parsed = reinstateSchema.safeParse({
    userId: formData.get("userId"),
    disputeId: formData.get("disputeId") ?? undefined,
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

  let returned: string;
  try {
    returned = await reinstateAccount({ userId: parsed.data.userId, adminId: user.id });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Reinstatement failed" };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "account_reinstate",
    targetType: "user",
    targetId: parsed.data.userId,
    detail: `reinstated on appeal; returned ${returned} USDT`,
  });

  await createNotification({
    userId: parsed.data.userId,
    type: "account_reinstated",
    title: "Account reinstated",
    body:
      Number(returned) > 0
        ? `Your account is active again and ${formatUsdt(returned)} USDT was returned.`
        : "Your account is active again — you can trade.",
    href: "/dashboard",
  });

  revalidatePath("/admin/accounts");
  if (parsed.data.disputeId) {
    revalidatePath(`/admin/disputes/${parsed.data.disputeId}`);
  }
  return { ok: true, returned };
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

  await notifyWithdrawalOwner(
    parsed.data.withdrawalId,
    "withdrawal_approved",
    "Withdrawal approved",
    (amt) => `${amt} USDT approved — it will be sent shortly.`,
  );

  revalidatePath("/admin/withdrawals");
  return {};
}

/** Notify the owner of a withdrawal (best-effort; looks up user + amount). */
async function notifyWithdrawalOwner(
  withdrawalId: string,
  type: string,
  title: string,
  body: (amount: string) => string,
): Promise<void> {
  try {
    const admin = createAdminSupabase();
    const { data: w } = await admin
      .from("withdrawals")
      .select("user_id, amount_usdt::text")
      .eq("id", withdrawalId)
      .maybeSingle();
    if (w) {
      await createNotification({
        userId: w.user_id,
        type,
        title,
        body: body(formatUsdt(w.amount_usdt)),
        href: "/dashboard",
      });
    }
  } catch {
    /* notifications are best-effort */
  }
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

  await notifyWithdrawalOwner(
    parsed.data.withdrawalId,
    "withdrawal_rejected",
    "Withdrawal rejected",
    (amt) => `${amt} USDT was rejected and refunded to your balance.`,
  );

  revalidatePath("/admin/withdrawals");
  return {};
}

// ── Reconcile a stuck (SENDING) withdrawal ───────────────────────────────────
// A SENDING row is one the signer claimed but couldn't finish recording, so its
// fate (sent vs. not) is unknown until an admin checks the chain. These two
// actions are the resolution: confirm it sent (with the verified tx hash) or
// confirm it didn't and refund. Same triple authorization as approve/reject.
const reconcileSentSchema = z.object({
  withdrawalId: z.string().uuid(),
  txHash: z.string().trim().min(1, "Enter the on-chain tx hash").max(120),
});
const reconcileRefundSchema = z.object({
  withdrawalId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export async function reconcileWithdrawalSentAction(
  _prev: WithdrawalReviewState,
  formData: FormData,
): Promise<WithdrawalReviewState> {
  const parsed = reconcileSentSchema.safeParse({
    withdrawalId: formData.get("withdrawalId"),
    txHash: formData.get("txHash"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Not authorized" };
  }

  try {
    await reconcileWithdrawalSent(
      parsed.data.withdrawalId,
      user.id,
      parsed.data.txHash,
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Reconcile failed" };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "withdrawal_reconcile_sent",
    targetType: "withdrawal",
    targetId: parsed.data.withdrawalId,
    detail: `tx ${parsed.data.txHash}`,
  });

  revalidatePath("/admin/withdrawals");
  return {};
}

export async function reconcileWithdrawalRefundAction(
  _prev: WithdrawalReviewState,
  formData: FormData,
): Promise<WithdrawalReviewState> {
  const parsed = reconcileRefundSchema.safeParse({
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

  const reason =
    parsed.data.reason?.trim() || "Reconciled by admin: did not broadcast";
  try {
    await reconcileWithdrawalRefund(
      parsed.data.withdrawalId,
      user.id,
      reason,
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Reconcile failed" };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "withdrawal_reconcile_refund",
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

// The admin enters the fee as a PERCENTAGE (e.g. "1" = 1%, "0.25" = 0.25%),
// which is the natural mental model; we convert to basis points for storage.
// Min/max are optional USDT amounts; blank means "no floor" / "no cap".
const PERCENT_RE = /^\d+(\.\d+)?$/;
const feeSchema = z.object({
  percent: z
    .string()
    .trim()
    .refine((s) => PERCENT_RE.test(s), "Enter a percentage like 0.25 or 1")
    .refine((s) => Number(s) >= 0 && Number(s) <= 100, "Fee must be 0–100%"),
  seller_percent: z
    .string()
    .trim()
    .refine((s) => PERCENT_RE.test(s), "Enter a seller fee like 0.25 or 1")
    .refine((s) => Number(s) >= 0 && Number(s) <= 100, "Seller fee must be 0–100%"),
  min: z.string().trim().optional(),
  max: z.string().trim().optional(),
});

export type FeeState = { error?: string; ok?: boolean };

/**
 * Admin sets the per-trade commission fee (migration 0020). The fee is a
 * percentage of each released trade, clamped to an optional [min, max] USDT
 * band; 0% disables it. Same triple authorization as every other admin action
 * (route guard, re-check here, and the SQL `set_platform_fee` re-checks
 * is_admin). The percentage is converted to basis points (1% = 100 bps) with
 * exact integer math so 0.01% resolution is preserved with no float drift.
 */
export async function setPlatformFeeAction(
  _prev: FeeState,
  formData: FormData,
): Promise<FeeState> {
  const parsed = feeSchema.safeParse({
    percent: formData.get("percent") ?? "",
    seller_percent: formData.get("seller_percent") ?? "0",
    min: formData.get("min") ?? "",
    max: formData.get("max") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  // percent → bps via exact integer micros (percent has ≤4 dp → bps integer).
  // toMicros(percent) yields percent×1e6; ×100 (bps per percent) / 1e6 = bps.
  let bps: number;
  let sellerBps: number;
  let minStr = "0";
  let maxStr: string | null = null;
  try {
    const bpsMicros = toMicros(parsed.data.percent) * 100n;
    if (bpsMicros % 1_000_000n !== 0n) {
      return { error: "Fee percentage is too precise (max 0.01% steps)" };
    }
    bps = Number(bpsMicros / 1_000_000n);

    const sBpsMicros = toMicros(parsed.data.seller_percent) * 100n;
    if (sBpsMicros % 1_000_000n !== 0n) {
      return { error: "Seller fee percentage is too precise (max 0.01% steps)" };
    }
    sellerBps = Number(sBpsMicros / 1_000_000n);

    if (parsed.data.min) {
      minStr = parsed.data.min;
      toMicros(minStr); // validate it parses as USDT
    }
    if (parsed.data.max) {
      maxStr = parsed.data.max;
      if (toMicros(maxStr) < toMicros(minStr)) {
        return { error: "Maximum fee can't be less than the minimum fee" };
      }
    }
  } catch {
    return { error: "Min/max must be valid USDT amounts (max 6 decimals)" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Not authorized" };
  }

  try {
    await setPlatformFee(user.id, { bps, min: minStr, max: maxStr });
    await setSellerFee(user.id, sellerBps);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not set the fee" };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "platform_fee_set",
    targetType: "platform_settings",
    detail:
      `fee ${parsed.data.percent}% (${bps} bps)` +
      `, min ${minStr}` +
      (maxStr ? `, max ${maxStr}` : ", no cap"),
  });

  revalidatePath("/admin/settings");
  return { ok: true };
}

// Trade-policy inputs. Caps are optional USDT amounts where blank = "unlimited";
// the bond minimum is required and positive; tier thresholds are whole numbers.
const AMOUNT_RE = /^\d+(\.\d+)?$/;
const tradePolicySchema = z.object({
  minBond: z
    .string()
    .trim()
    .refine((s) => AMOUNT_RE.test(s) && Number(s) > 0, "Enter a positive bond minimum"),
  newCap: z.string().trim().optional(),
  activeCap: z.string().trim().optional(),
  establishedCap: z.string().trim().optional(),
  activeAfter: z
    .string()
    .trim()
    .refine((s) => /^\d+$/.test(s) && Number(s) >= 1, "Active tier needs ≥ 1 trade"),
  establishedAfter: z
    .string()
    .trim()
    .refine((s) => /^\d+$/.test(s) && Number(s) >= 1, "Established tier needs ≥ 1 trade"),
});

export type TradePolicyState = { error?: string; ok?: boolean };

/**
 * Admin tunes the per-order trade limits and the merchant-bond minimum
 * (migration 0021). Caps left blank mean "unlimited" for that tier. Same triple
 * authorization as every other admin action (route guard, re-check here, and the
 * SQL `set_trade_policy` re-checks is_admin and validates the band).
 */
export async function setTradePolicyAction(
  _prev: TradePolicyState,
  formData: FormData,
): Promise<TradePolicyState> {
  const parsed = tradePolicySchema.safeParse({
    minBond: formData.get("minBond") ?? "",
    newCap: formData.get("newCap") ?? "",
    activeCap: formData.get("activeCap") ?? "",
    establishedCap: formData.get("establishedCap") ?? "",
    activeAfter: formData.get("activeAfter") ?? "",
    establishedAfter: formData.get("establishedAfter") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  // A blank cap → null (unlimited); a present cap must be a valid USDT amount.
  const cap = (raw: string | undefined): number | null => {
    const s = (raw ?? "").trim();
    if (s === "") return null;
    toMicros(s); // throws on bad shape / too many decimals
    return Number(s);
  };

  let newCap: number | null;
  let activeCap: number | null;
  let establishedCap: number | null;
  try {
    newCap = cap(parsed.data.newCap);
    activeCap = cap(parsed.data.activeCap);
    establishedCap = cap(parsed.data.establishedCap);
  } catch {
    return { error: "Trade limits must be valid USDT amounts (max 6 decimals)" };
  }

  const activeAfter = Number(parsed.data.activeAfter);
  const establishedAfter = Number(parsed.data.establishedAfter);
  if (establishedAfter < activeAfter) {
    return {
      error: "Established tier can't require fewer trades than the active tier",
    };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Not authorized" };
  }

  try {
    await setTradePolicy(user.id, {
      minMerchantBond: Number(parsed.data.minBond),
      newCap,
      activeCap,
      establishedCap,
      activeAfter,
      establishedAfter,
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not set the trade policy",
    };
  }

  const fmtCap = (c: number | null) => (c === null ? "∞" : String(c));
  await recordAdminAction({
    adminId: user.id,
    action: "trade_policy_set",
    targetType: "platform_settings",
    detail:
      `bond ≥ ${parsed.data.minBond}; caps new ${fmtCap(newCap)} / ` +
      `active ${fmtCap(activeCap)} (≥${activeAfter}) / ` +
      `established ${fmtCap(establishedCap)} (≥${establishedAfter})`,
  });

  revalidatePath("/admin/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}

// The order payment window, in whole minutes (≥ 1). This is how long a buyer has
// to pay before an unpaid order is eligible for auto-cancel.
const orderTtlSchema = z.object({
  minutes: z
    .string()
    .trim()
    .refine((s) => /^\d+$/.test(s) && Number(s) >= 1, "Window must be ≥ 1 minute")
    .refine((s) => Number(s) <= 1440, "Window can't exceed 1440 minutes (24h)"),
});

export type OrderTtlState = { error?: string; ok?: boolean };

/**
 * Admin sets the order payment window (migration 0022) — the minutes a buyer has
 * to pay before an unpaid order is auto-cancelled. Same triple authorization as
 * every other admin action (route guard, re-check here, and the SQL
 * `set_order_ttl` re-checks is_admin). order_create reads this live, so the new
 * window applies to every order opened after the change.
 */
export async function setOrderTtlAction(
  _prev: OrderTtlState,
  formData: FormData,
): Promise<OrderTtlState> {
  const parsed = orderTtlSchema.safeParse({
    minutes: formData.get("minutes") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }
  const minutes = Number(parsed.data.minutes);

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Not authorized" };
  }

  try {
    await setOrderTtlMinutes(user.id, minutes);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not set the payment window",
    };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "order_ttl_set",
    targetType: "platform_settings",
    detail: `order payment window ${minutes} min`,
  });

  revalidatePath("/admin/settings");
  revalidatePath("/market");
  return { ok: true };
}

const releaseWindowSchema = z.object({
  minutes: z
    .string()
    .trim()
    .refine((s) => /^\d+$/.test(s) && Number(s) >= 1, "Window must be ≥ 1 minute")
    .refine((s) => Number(s) <= 1440, "Window can't exceed 1440 minutes (24h)"),
});

export type ReleaseWindowState = { error?: string; ok?: boolean };

/**
 * Admin sets the seller release window (migration 0042) — the minutes a seller has
 * to confirm + release AFTER the buyer marks paid. order_mark_paid reads this live
 * and stamps a fresh deadline, so the new value applies to every order marked paid
 * after the change. Same triple authorization as every other admin action.
 */
export async function setReleaseWindowAction(
  _prev: ReleaseWindowState,
  formData: FormData,
): Promise<ReleaseWindowState> {
  const parsed = releaseWindowSchema.safeParse({
    minutes: formData.get("minutes") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }
  const minutes = Number(parsed.data.minutes);

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Not authorized" };
  }

  try {
    await setReleaseWindowMinutes(user.id, minutes);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not set the release window",
    };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "release_window_set",
    targetType: "platform_settings",
    detail: `seller release window ${minutes} min`,
  });

  revalidatePath("/admin/settings");
  return { ok: true };
}

const feeUsdtSchema = z.object({
  fee: z
    .string()
    .trim()
    .refine(
      (s) => /^\d+(\.\d{1,6})?$/.test(s) && Number(s) >= 0,
      "Fee must be a non-negative USDT amount (up to 6 decimals)",
    )
    .refine((s) => Number(s) <= 100, "Fee can't exceed 100 USDT"),
});
const withdrawalFeeSchema = feeUsdtSchema;

export type WithdrawalFeeState = { error?: string; ok?: boolean };
export type TransferFeeState = { error?: string; ok?: boolean };

/**
 * Admin sets the flat internal-transfer fee (migration 0049) — deducted from a
 * transfer so the recipient gets amount − fee. 0 = free. Same triple auth.
 */
export async function setInternalTransferFeeAction(
  _prev: TransferFeeState,
  formData: FormData,
): Promise<TransferFeeState> {
  const parsed = feeUsdtSchema.safeParse({ fee: formData.get("fee") ?? "" });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) return { error: "Not authorized" };

  try {
    await setInternalTransferFee(user.id, parsed.data.fee);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not set the transfer fee",
    };
  }
  await recordAdminAction({
    adminId: user.id,
    action: "transfer_fee_set",
    targetType: "platform_settings",
    detail: `internal transfer fee ${parsed.data.fee} USDT`,
  });
  revalidatePath("/admin/settings");
  return { ok: true };
}

/**
 * Admin sets the flat withdrawal fee (migration 0045) — deducted from each
 * withdrawal so the user covers on-chain gas. requestWithdrawal reads this live
 * and bakes it onto the row, so the new value applies to withdrawals requested
 * after the change. Same triple authorization as every other admin action.
 */
export async function setWithdrawalFeeAction(
  _prev: WithdrawalFeeState,
  formData: FormData,
): Promise<WithdrawalFeeState> {
  const parsed = withdrawalFeeSchema.safeParse({
    fee: formData.get("fee") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Not authorized" };
  }

  try {
    await setWithdrawalFee(user.id, parsed.data.fee);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not set the withdrawal fee",
    };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "withdrawal_fee_set",
    targetType: "platform_settings",
    detail: `withdrawal fee ${parsed.data.fee} USDT`,
  });

  revalidatePath("/admin/settings");
  return { ok: true };
}

// The deposit-gas strategy (migration 0029). pooledAddress only applies to the
// 'pooled' strategy; blank means "use the hot-wallet address".
const sweepStrategySchema = z.object({
  strategy: z.enum(["staking", "rental", "burn", "pooled"]),
  pooledAddress: z.string().trim().optional(),
});

export type SweepStrategyState = { error?: string; ok?: boolean };

/**
 * Admin selects how the sweeper provisions Energy (or whether it pools deposits
 * and skips sweeping). Same triple authorization as every other admin action
 * (route guard, re-check here, and the SQL `set_sweep_strategy` re-checks
 * is_admin). Removes the old TRX-burn top-up entirely.
 */
export async function setSweepStrategyAction(
  _prev: SweepStrategyState,
  formData: FormData,
): Promise<SweepStrategyState> {
  const parsed = sweepStrategySchema.safeParse({
    strategy: formData.get("strategy"),
    pooledAddress: formData.get("pooledAddress") ?? "",
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

  const strategy = parsed.data.strategy as SweepStrategy;
  const pooledAddress =
    strategy === "pooled" ? parsed.data.pooledAddress || null : null;

  try {
    await setSweepStrategy(user.id, strategy, pooledAddress);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not set the sweep strategy",
    };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "sweep_strategy_set",
    targetType: "platform_settings",
    detail:
      `strategy ${strategy}` +
      (pooledAddress ? `; pooled address ${pooledAddress}` : ""),
  });

  revalidatePath("/admin/settings");
  return { ok: true };
}

// Freeze/unfreeze the hot wallet's TRX for Energy (staking strategy). Amount is a
// positive TRX decimal string.
const TRX_AMOUNT_RE = /^\d+(\.\d+)?$/;
const energyStakeSchema = z.object({
  amount: z
    .string()
    .trim()
    .refine((s) => TRX_AMOUNT_RE.test(s) && Number(s) > 0, "Enter a positive TRX amount"),
});

export type EnergyStakeState = { error?: string; ok?: boolean; txHash?: string };

/**
 * Admin stakes (FreezeBalanceV2) hot-wallet TRX for Energy so the staking sweep
 * strategy can delegate it to deposit addresses. Requires live payments to be on
 * (the stub can't move real funds). Triple-authorized like every admin action.
 */
export async function freezeEnergyAction(
  _prev: EnergyStakeState,
  formData: FormData,
): Promise<EnergyStakeState> {
  return energyStakeMutation(formData, "freeze");
}

/** Admin unstakes (UnfreezeBalanceV2) hot-wallet Energy. */
export async function unfreezeEnergyAction(
  _prev: EnergyStakeState,
  formData: FormData,
): Promise<EnergyStakeState> {
  return energyStakeMutation(formData, "unfreeze");
}

async function energyStakeMutation(
  formData: FormData,
  op: "freeze" | "unfreeze",
): Promise<EnergyStakeState> {
  const parsed = energyStakeSchema.safeParse({ amount: formData.get("amount") ?? "" });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Not authorized" };
  }

  if (!(await isLivePaymentsEnabled())) {
    return { error: "Enable live payments before staking TRX for Energy." };
  }

  let txHash: string;
  try {
    const provider = await getChainProvider();
    const result =
      op === "freeze"
        ? await provider.freezeForEnergy(parsed.data.amount)
        : await provider.unfreezeEnergy(parsed.data.amount);
    txHash = result.txHash;
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : `Could not ${op} TRX for Energy`,
    };
  }

  await recordAdminAction({
    adminId: user.id,
    action: op === "freeze" ? "energy_freeze" : "energy_unfreeze",
    targetType: "platform_settings",
    detail: `${op} ${parsed.data.amount} TRX for Energy; tx=${txHash}`,
  });

  revalidatePath("/admin/settings");
  return { ok: true, txHash };
}

const kycSchema = z.object({
  submissionId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export type KycReviewState = { error?: string };

const kycApproveSchema = z.object({
  submissionId: z.string().uuid(),
  idNumber: z
    .string()
    .trim()
    .min(2, "Enter the ID/passport number from the document before approving."),
});

/**
 * Admin clears a pending identity submission; the account becomes APPROVED and
 * the database triggers (migration 0015) stop blocking that user's trades. The
 * admin reads the ID/passport number off the uploaded document and records it
 * here — the SQL normalises it, blocks it if it's already verified on another
 * account, and stores it (migration 0041). Same triple authorization as the
 * other admin actions (route guard, here, and SQL).
 */
export async function approveKycAction(
  _prev: KycReviewState,
  formData: FormData,
): Promise<KycReviewState> {
  const parsed = kycApproveSchema.safeParse({
    submissionId: formData.get("submissionId"),
    idNumber: formData.get("idNumber"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) {
    return { error: "Not authorized" };
  }

  try {
    await approveKyc(parsed.data.submissionId, user.id, parsed.data.idNumber);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Approval failed" };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "kyc_approve",
    targetType: "kyc_submission",
    targetId: parsed.data.submissionId,
  });

  await notifyKycUser(
    parsed.data.submissionId,
    "kyc_approved",
    "Identity verified",
    "Your identity was approved — you can now trade.",
    "/dashboard",
  );

  revalidatePath("/admin/kyc");
  return {};
}

export type KycIdCheckState = { taken?: boolean; error?: string };

/**
 * Live lookup for the review box: as the admin types the ID number, tell them
 * whether it's already verified on a DIFFERENT account so they can reject the
 * duplicate without having to attempt an approval. Read-only; the authoritative
 * block still lives in kyc_approve + the unique index.
 */
export async function checkKycIdNumberAction(
  submissionId: string,
  idNumber: string,
): Promise<KycIdCheckState> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  if (!(await isAdmin(supabase, user.id))) return { error: "Not authorized" };
  if (!z.string().uuid().safeParse(submissionId).success) {
    return { error: "Invalid request" };
  }
  // Too short to be a real number yet — don't flag anything.
  if (idNumber.trim().length < 2) return {};

  const admin = createAdminSupabase();
  const { data: sub } = await admin
    .from("kyc_submissions")
    .select("user_id")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub) return { error: "Submission not found" };

  try {
    const taken = await isKycIdNumberTaken(idNumber, sub.user_id);
    return { taken };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Check failed" };
  }
}

/** Notify a KYC submission's owner (best-effort; looks up the user). */
async function notifyKycUser(
  submissionId: string,
  type: string,
  title: string,
  body: string,
  href: string,
): Promise<void> {
  try {
    const admin = createAdminSupabase();
    const { data: sub } = await admin
      .from("kyc_submissions")
      .select("user_id")
      .eq("id", submissionId)
      .maybeSingle();
    if (sub) {
      await createNotification({ userId: sub.user_id, type, title, body, href });
    }
  } catch {
    /* notifications are best-effort */
  }
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

  await notifyKycUser(
    parsed.data.submissionId,
    "kyc_rejected",
    "Verification not approved",
    `Your submission was rejected — you can resubmit. ${reason}`,
    "/verify",
  );

  revalidatePath("/admin/kyc");
  return {};
}
