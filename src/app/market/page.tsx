import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { fetchActiveAds } from "@/lib/ads";
import { SiteHeader } from "@/components/site-header";
import { OrderBook } from "./order-book";

export default async function MarketPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards /market; this is defence-in-depth.
  if (!user) redirect("/login");

  // Initial server render uses the RLS-bound session client; the order book
  // then keeps itself live over Realtime from the browser.
  const initialAds = await fetchActiveAds(supabase);

  return (
    <>
      <SiteHeader phone={user.phone} active="market" userId={user.id} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink">Order book</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Live offers from traders. Rates in ETB per USDT.
            </p>
          </div>
          <Link
            href="/market/new"
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper-raised hover:bg-ink-soft"
          >
            Post an ad
          </Link>
        </div>

        <div className="mt-6">
          <OrderBook initialAds={initialAds} currentUserId={user.id} />
        </div>
      </main>
    </>
  );
}
