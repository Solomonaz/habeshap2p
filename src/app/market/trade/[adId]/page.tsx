import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { fetchAd } from "@/lib/ads";
import { fetchKycStatus } from "@/lib/kyc";
import { tradeLimitUsdt } from "@/lib/reputation";
import { SiteHeader } from "@/components/site-header";
import { accountLabel } from "@/lib/identity";
import { TradeForm } from "./trade-form";

export default async function TradePage({
  params,
}: {
  params: Promise<{ adId: string }>;
}) {
  const { adId } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Taking an order locks USDT — a trading action, blocked until verified.
  if ((await fetchKycStatus(supabase, user.id)) !== "APPROVED") {
    redirect("/verify");
  }

  const [ad, { data: profile }] = await Promise.all([
    fetchAd(supabase, adId),
    supabase
      .from("users")
      .select("is_merchant, completed_trades")
      .eq("id", user.id)
      .single(),
  ]);

  // The taker's per-order cap (rule #5). SQL enforces it on both parties; we
  // surface the taker's so they see it before submitting. null = unlimited.
  const takerLimit = tradeLimitUsdt({
    isMerchant: profile?.is_merchant ?? false,
    completedTrades: profile?.completed_trades ?? 0,
  });

  return (
    <>
      <SiteHeader account={accountLabel(user)} active="market" userId={user.id} />
      <main className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-10">
        <Link href="/market" className="text-sm text-ink-muted hover:text-ink">
          ← Back to order book
        </Link>

        {!ad || ad.status !== "ACTIVE" ? (
          <p className="mt-8 text-sm text-ink-muted">
            This ad is no longer available.
          </p>
        ) : ad.user_id === user.id ? (
          <p className="mt-8 text-sm text-ink-muted">
            This is your own ad — you can&apos;t trade against it. Manage it in{" "}
            <Link href="/market/mine" className="text-amber underline">
              My ads
            </Link>
            .
          </p>
        ) : (
          <TradeForm ad={ad} takerLimit={takerLimit} />
        )}
      </main>
    </>
  );
}
