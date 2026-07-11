import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { fetchSupportThread, markSupportReadUser } from "@/lib/support";
import { SiteHeader } from "@/components/site-header";
import { accountLabel } from "@/lib/identity";
import { SupportThread } from "./support-thread";

export const dynamic = "force-dynamic";

/**
 * The trader's support conversation with the HabeshaP2P team. Opening the page
 * marks any admin replies read (clears the badge). Messages stream in live.
 */
export default async function SupportPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const messages = await fetchSupportThread(supabase, user.id);
  await markSupportReadUser(user.id); // viewing the thread = read

  return (
    <>
      <SiteHeader account={accountLabel(user)} userId={user.id} />
      <main className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-xl font-semibold text-ink">Contact support</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Message the HabeshaP2P team — a question, a problem, or help with a
          trade. We&apos;ll reply right here and send you a notification.
        </p>
        <SupportThread userId={user.id} initialMessages={messages} />
      </main>
    </>
  );
}
