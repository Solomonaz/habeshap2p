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
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              Order book
            </h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              Live offers from traders. Rates in ETB per USDT, settled with
              escrow.
            </p>
          </div>
          <Link href="/market/new" className="btn-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
            Post an ad
          </Link>
        </div>

        <div className="panel mt-7 p-5 sm:p-6">
          <OrderBook initialAds={initialAds} currentUserId={user.id} />
        </div>
      </main>
    </>
  );
}
