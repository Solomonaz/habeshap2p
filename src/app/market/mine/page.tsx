import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { fetchMyAds } from "@/lib/ads";
import { SiteHeader } from "@/components/site-header";
import { MyAds } from "./my-ads";

export default async function MyAdsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ads = await fetchMyAds(supabase, user.id);

  return (
    <>
      <SiteHeader phone={user.phone} active="mine" userId={user.id} />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink">My ads</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Pause hides an ad from the order book; close retires it.
            </p>
          </div>
          <Link
            href="/market/new"
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper-raised hover:bg-ink-soft"
          >
            Post an ad
          </Link>
        </div>
        <MyAds ads={ads} />
      </main>
    </>
  );
}
