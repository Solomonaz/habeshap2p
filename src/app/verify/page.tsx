import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { fetchKycStatus, fetchLatestSubmission } from "@/lib/kyc";
import { SiteHeader } from "@/components/site-header";
import { accountLabel } from "@/lib/identity";
import { VerifyForm } from "./verify-form";

export const dynamic = "force-dynamic";

/**
 * Identity verification gate (Stage 2). Every account must upload a government
 * ID + liveness selfie and be approved by an admin before it can trade, post
 * ads, or withdraw. The database triggers (migration 0015) are the hard backstop;
 * this page is the user-facing path through that gate.
 */
export default async function VerifyPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [status, latest] = await Promise.all([
    fetchKycStatus(supabase, user.id),
    fetchLatestSubmission(supabase, user.id),
  ]);

  const defaultName =
    latest?.full_name ??
    (typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : "");

  return (
    <>
      <SiteHeader account={accountLabel(user)} userId={user.id} />
      <main className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-xl font-semibold text-ink">Verify your identity</h1>
        <p className="mt-1 text-sm text-ink-muted">
          To protect against scammers, we verify every trader before they can buy,
          sell, or withdraw. This is reviewed by our team.
        </p>

        {status === "APPROVED" ? (
          <div className="mt-6 rounded-card border border-state-released/40 bg-buy-wash p-5">
            <h2 className="text-sm font-medium text-state-released">
              You&apos;re verified
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Your identity has been confirmed. You can trade freely.
            </p>
            <Link
              href="/market"
              className="mt-4 inline-block text-sm text-amber underline"
            >
              Go to the order book
            </Link>
          </div>
        ) : status === "PENDING" ? (
          <div className="mt-6 rounded-card border border-amber/40 bg-amber-wash p-5">
            <h2 className="text-sm font-medium text-amber">Under review</h2>
            <p className="mt-1 text-sm text-ink-soft">
              We&apos;ve received your documents and our team is reviewing them.
              You&apos;ll be able to trade as soon as you&apos;re approved.
            </p>
          </div>
        ) : (
          <>
            {status === "REJECTED" && (
              <div className="mt-6 rounded-card border border-sell/40 bg-sell-wash p-4">
                <h2 className="text-sm font-medium text-state-disputed">
                  Your last submission was rejected
                </h2>
                {latest?.rejection_reason && (
                  <p className="mt-1 text-sm text-ink-soft">
                    Reason: {latest.rejection_reason}
                  </p>
                )}
                <p className="mt-1 text-sm text-ink-soft">
                  Please correct the issue and submit again.
                </p>
              </div>
            )}
            <VerifyForm userId={user.id} defaultFullName={defaultName} />
          </>
        )}
      </main>
    </>
  );
}
