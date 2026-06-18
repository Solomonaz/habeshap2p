"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { AD_STATUSES } from "@/types/domain";

const schema = z.object({
  adId: z.string().uuid(),
  status: z.enum(AD_STATUSES),
});

export type SetAdStatusState = { error?: string };

/**
 * Changes one of the current user's ads to PAUSED / ACTIVE / CLOSED. RLS only
 * lets a user update their own ads, so ownership is enforced by the database;
 * the explicit user_id filter is belt-and-braces and scopes the row.
 */
export async function setAdStatus(
  _prev: SetAdStatusState,
  formData: FormData,
): Promise<SetAdStatusState> {
  const parsed = schema.safeParse({
    adId: formData.get("adId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: "Invalid request" };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("ads")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.adId)
    .eq("user_id", user.id);

  if (error) return { error: `Could not update ad: ${error.message}` };

  revalidatePath("/market/mine");
  return {};
}
