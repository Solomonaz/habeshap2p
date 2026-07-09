import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { fetchMyAds } from "@/lib/ads";
import { SiteHeader } from "@/components/site-header";
import { accountLabel } from "@/lib/identity";
import { sellMaxExceedsBalance, maxEtbForBalance } from "@/lib/ad-capacity";
import { MyAds, type MyAdRow } from "./my-ads";

export default async function MyAdsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rawAds = await fetchMyAds(supabase, user.id);

  // Flag SELL ads whose max the seller's current balance can no longer fund, and
  // suggest the max their balance actually supports — so the seller sees exactly
  // which ad to fix and to what. Reads the owner's OWN wallet (RLS-allowed).
  const { data: wallet } = await supabase
    .from("wallets")
    .select("usdt_available::text")
    .eq("user_id", user.id)
    .single();
  const available = wallet?.usdt_available ?? "0";
  const ads: MyAdRow[] = rawAds.map((ad) => {
    if (ad.side !== "SELL" || ad.status === "CLOSED") return { ...ad };
    const underfunded = sellMaxExceedsBalance(ad.max_etb, available, ad.rate_etb);
    return {
      ...ad,
      funding: underfunded
        ? { available, cap: maxEtbForBalance(available, ad.rate_etb) }
        : null,
    };
  });

  return (
    <>
      <SiteHeader account={accountLabel(user)} active="mine" userId={user.id} />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink">My ads</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Pause hides an ad from the order book; close retires it.
            </p>
          </div>
          <Link href="/market/new" className="btn-primary">
            Post an ad
          </Link>
        </div>
        <MyAds ads={ads} />
      </main>
    </>
  );
}
