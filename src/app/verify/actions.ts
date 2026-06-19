"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { submitKyc } from "@/lib/kyc";

// The images are uploaded to the private `kyc` bucket on the client (the storage
// RLS only admits objects under the user's own folder), and their object paths
// are submitted here. We re-derive the path prefix from the session user so a
// client can't file someone else's uploads against its own account.
const schema = z.object({
  idDocumentPath: z.string().min(1),
  livenessPath: z.string().min(1),
  fullName: z.string().trim().min(2, "Please enter your full name."),
});

export type VerifyState = { error?: string };

export async function submitVerification(
  _prev: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const parsed = schema.safeParse({
    idDocumentPath: formData.get("idDocumentPath"),
    livenessPath: formData.get("livenessPath"),
    fullName: formData.get("fullName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid submission" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Both object paths must live under this user's own folder (`<userId>/…`),
  // matching what the storage write policy allowed.
  const prefix = `${user.id}/`;
  if (
    !parsed.data.idDocumentPath.startsWith(prefix) ||
    !parsed.data.livenessPath.startsWith(prefix)
  ) {
    return { error: "Uploaded files do not belong to your account." };
  }

  try {
    await submitKyc({
      userId: user.id,
      idDocumentPath: parsed.data.idDocumentPath,
      livenessPath: parsed.data.livenessPath,
      fullName: parsed.data.fullName,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Submission failed" };
  }

  revalidatePath("/verify");
  return {};
}
