"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { adminReplySupport } from "@/lib/support";

const schema = z.object({
  userId: z.string().uuid(),
  body: z
    .string()
    .trim()
    .min(1, "Type a reply")
    .max(2000, "Reply is too long (max 2000 characters)"),
});

export type AdminReplyState = { error?: string; ok?: boolean };

/** An admin replies on a trader's support thread (notifies the trader). */
export async function replySupportAction(
  _prev: AdminReplyState,
  formData: FormData,
): Promise<AdminReplyState> {
  const parsed = schema.safeParse({
    userId: formData.get("userId"),
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid reply" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) return { error: "Not authorized" };

  try {
    await adminReplySupport(user.id, parsed.data.userId, parsed.data.body);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not send reply" };
  }

  revalidatePath(`/admin/support/${parsed.data.userId}`);
  revalidatePath("/admin/support");
  return { ok: true };
}
