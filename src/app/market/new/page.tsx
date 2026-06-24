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

  // The seller's available USDT bounds how large a SELL ad's max order may be
  // (orders lock USDT in escrow). Read as text for exact-decimal handling.
  const { data: wallet } = await supabase
    .from("wallets")
    .select("usdt_available::text")
    .eq("user_id", user.id)
    .single();
  const availableUsdt = wallet?.usdt_available ?? "0";

  // One open ad per side (migration 0028): a user may hold at most one live SELL
  // and one live BUY ad. Find which sides are already taken (ACTIVE/PAUSED) so
  // the form can pre-empt a doomed post with a friendly message + a link to
  // close/edit the existing one, rather than letting the server action reject it.
  const { data: openAds } = await supabase
    .from("ads")
    .select("side")
    .eq("user_id", user.id)
    .neq("status", "CLOSED");
  const takenSides = (openAds ?? []).map((a) => a.side);

  return (
    <>
      <SiteHeader account={accountLabel(user)} active="market" userId={user.id} />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-xl font-semibold text-ink">Post an ad</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Advertise a rate. Orders against it lock USDT in escrow — that part
          arrives in Phase 3.
        </p>
        <AdForm availableUsdt={availableUsdt} takenSides={takenSides} />
      </main>
    </>
  );
}
