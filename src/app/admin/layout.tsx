import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { accountIdentity } from "@/lib/identity";
import { fetchNotifications } from "@/lib/notifications";
import { AdminShell } from "@/components/admin/admin-shell";

// The admin console must never be indexed (defence beyond the robots.txt disallow).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Shared chrome + gate for the whole /admin console. Resolving the admin check
 * and the identity once here means the individual pages render only their data
 * inside the dashboard shell. Each page keeps its own defence-in-depth check.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, is_admin")
    .eq("id", user.id)
    .maybeSingle();
  // Non-admins must not even learn this area exists.
  if (profile?.is_admin !== true) redirect("/market");

  const account = accountIdentity(user, profile?.full_name);
  const notifications = await fetchNotifications(supabase, user.id);

  return (
    <AdminShell account={account} userId={user.id} notifications={notifications}>
      {children}
    </AdminShell>
  );
}
