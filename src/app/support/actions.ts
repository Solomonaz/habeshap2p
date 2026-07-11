"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { sendUserSupportMessage } from "@/lib/support";

const schema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Type a message")
    .max(2000, "Message is too long (max 2000 characters)"),
});

export type SupportState = { error?: string; ok?: boolean };

/** A signed-in trader posts a message to their own support thread. */
export async function sendSupportAction(
  _prev: SupportState,
  formData: FormData,
): Promise<SupportState> {
  const parsed = schema.safeParse({ body: formData.get("body") ?? "" });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid message" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  try {
    await sendUserSupportMessage(user.id, parsed.data.body);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not send your message",
    };
  }

  revalidatePath("/support");
  return { ok: true };
}
