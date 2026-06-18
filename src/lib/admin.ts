import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Is this user an admin? Read through the RLS session client — a user can read
 * their OWN users row (policy users_select_own), and the is_admin column is
 * server-maintained (trigger in 0002), so it can be trusted as a flag here.
 * Returns false on any error or missing row rather than throwing.
 */
export async function isAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  return data?.is_admin === true;
}
