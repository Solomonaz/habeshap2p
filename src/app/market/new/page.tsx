import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/site-header";
import { AdForm } from "./ad-form";

export default async function NewAdPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <>
      <SiteHeader phone={user.phone} active="market" userId={user.id} />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-xl font-semibold text-ink">Post an ad</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Advertise a rate. Orders against it lock USDT in escrow — that part
          arrives in Phase 3.
        </p>
        <AdForm />
      </main>
    </>
  );
}
