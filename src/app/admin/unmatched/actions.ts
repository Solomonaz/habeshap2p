"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { recordAdminAction } from "@/lib/audit";
import {
  creditUnmatchedDeposit,
  ignoreUnmatchedDeposit,
  unignoreUnmatchedDeposit,
  resolveUserByEmail,
} from "@/lib/unmatched";

export type UnmatchedState = { error?: string; ok?: boolean };

const creditSchema = z.object({
  txHash: z.string().trim().min(1),
  // The form sends either a resolved userId (suggested quick-credit) or an email.
  userId: z.string().uuid().optional(),
  email: z.string().trim().optional(),
});

/**
 * Admin credits an unmatched pooled deposit to a user. Triple auth: route guard,
 * the re-check here, and the SQL `credit_unmatched_deposit` re-checks is_admin.
 * Crediting is idempotent (credit_deposit dedupes on tx hash).
 */
export async function creditUnmatchedAction(
  _prev: UnmatchedState,
  formData: FormData,
): Promise<UnmatchedState> {
  const parsed = creditSchema.safeParse({
    txHash: formData.get("txHash"),
    userId: formData.get("userId") || undefined,
    email: formData.get("email") || undefined,
  });
  if (!parsed.success) return { error: "Invalid request" };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) return { error: "Not authorized" };

  let userId = parsed.data.userId;
  if (!userId) {
    if (!parsed.data.email) {
      return { error: "Enter the user's email (or use the suggested account)." };
    }
    const resolved = await resolveUserByEmail(parsed.data.email);
    if (!resolved) {
      return { error: `No user found with email "${parsed.data.email}".` };
    }
    userId = resolved;
  }

  let amount: string;
  try {
    amount = await creditUnmatchedDeposit({
      txHash: parsed.data.txHash,
      userId,
      adminId: user.id,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Credit failed" };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "unmatched_deposit_credit",
    targetType: "user",
    targetId: userId,
    detail: `credited ${amount} USDT (tx ${parsed.data.txHash})`,
  });

  revalidatePath("/admin/unmatched");
  return { ok: true };
}

const ignoreSchema = z.object({
  txHash: z.string().trim().min(1),
  reason: z.string().trim().max(300).optional(),
});

export async function ignoreUnmatchedAction(
  _prev: UnmatchedState,
  formData: FormData,
): Promise<UnmatchedState> {
  const parsed = ignoreSchema.safeParse({
    txHash: formData.get("txHash"),
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) return { error: "Invalid request" };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) return { error: "Not authorized" };

  try {
    await ignoreUnmatchedDeposit({
      txHash: parsed.data.txHash,
      adminId: user.id,
      reason: parsed.data.reason,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to ignore" };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "unmatched_deposit_ignore",
    targetType: "unmatched_deposit",
    targetId: parsed.data.txHash,
    detail: parsed.data.reason,
  });

  revalidatePath("/admin/unmatched");
  return { ok: true };
}

export async function unignoreUnmatchedAction(
  _prev: UnmatchedState,
  formData: FormData,
): Promise<UnmatchedState> {
  const parsed = ignoreSchema.safeParse({ txHash: formData.get("txHash") });
  if (!parsed.success) return { error: "Invalid request" };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) return { error: "Not authorized" };

  try {
    await unignoreUnmatchedDeposit({
      txHash: parsed.data.txHash,
      adminId: user.id,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to un-ignore" };
  }

  await recordAdminAction({
    adminId: user.id,
    action: "unmatched_deposit_unignore",
    targetType: "unmatched_deposit",
    targetId: parsed.data.txHash,
  });

  revalidatePath("/admin/unmatched");
  return { ok: true };
}
