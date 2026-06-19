import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { fetchKycStatus } from "@/lib/kyc";
import { SiteHeader } from "@/components/site-header";
import { accountLabel } from "@/lib/identity";
import { AdForm } from "./ad-form";

export default async function NewAdPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Posting an ad is a trading action — blocked until identity is verified
  // (the DB triggers are the hard backstop; this is the friendly redirect).
  if ((await fetchKycStatus(supabase, user.id)) !== "APPROVED") {
    redirect("/verify");
  }

  return (
    <>
      <SiteHeader account={accountLabel(user)} active="market" userId={user.id} />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
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
