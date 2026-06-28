import { redirect } from "next/navigation";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { fetchPendingKyc, signedKycUrl } from "@/lib/kyc";
import { traderHandle } from "@/lib/handle";
import { KycReview } from "./review";

export const dynamic = "force-dynamic";

/**
 * Admin review queue for identity verification (Stage 2). Non-admins are bounced
 * before they can learn the route exists; the server action and SQL re-check
 * is_admin on every approve/reject. ID and liveness images are served through
 * short-lived signed URLs (the bucket is private).
 */
export default async function AdminKycPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  const pending = await fetchPendingKyc();

  // Signed URLs are minted with the service-role client (admins may read any
  // KYC object); they expire quickly so they aren't durable links.
  const admin = createAdminSupabase();
  const withUrls = await Promise.all(
    pending.map(async (s) => ({
      submission: s,
      idUrl: await signedKycUrl(admin, s.id_document_path),
      idBackUrl: s.id_document_back_path
        ? await signedKycUrl(admin, s.id_document_back_path)
        : null,
      livenessUrl: await signedKycUrl(admin, s.liveness_path),
    })),
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Identity verification
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Check that the liveness selfie matches the ID photo and that the name on
          the ID matches the attested name. Approving unlocks trading for the user.
        </p>

        {withUrls.length === 0 ? (
          <p className="mt-8 text-sm text-ink-muted">
            No submissions awaiting review.
          </p>
        ) : (
          <ul className="mt-6 space-y-4">
            {withUrls.map(({ submission: s, idUrl, idBackUrl, livenessUrl }) => (
              <li
                key={s.id}
                className="rounded-card border border-paper-border bg-paper-raised p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-ink">
                    {s.full_name}
                  </span>
                  <span className="text-xs text-ink-faint">
                    {traderHandle(s.user_id)} · submitted{" "}
                    {new Date(s.created_at).toLocaleString()}
                  </span>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <figure>
                    <figcaption className="mb-1 text-xs text-ink-muted">
                      ID — front
                    </figcaption>
                    {idUrl ? (
                      <a href={idUrl} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={idUrl}
                          alt="ID front"
                          className="w-full rounded-md border border-paper-border"
                        />
                      </a>
                    ) : (
                      <p className="text-xs text-sell">Image unavailable</p>
                    )}
                  </figure>
                  <figure>
                    <figcaption className="mb-1 text-xs text-ink-muted">
                      ID — back
                    </figcaption>
                    {idBackUrl ? (
                      <a href={idBackUrl} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={idBackUrl}
                          alt="ID back"
                          className="w-full rounded-md border border-paper-border"
                        />
                      </a>
                    ) : (
                      <p className="text-xs text-ink-faint">
                        Not provided (older submission)
                      </p>
                    )}
                  </figure>
                  <figure>
                    <figcaption className="mb-1 text-xs text-ink-muted">
                      Liveness selfie
                    </figcaption>
                    {livenessUrl ? (
                      <a href={livenessUrl} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={livenessUrl}
                          alt="Liveness selfie"
                          className="w-full rounded-md border border-paper-border"
                        />
                      </a>
                    ) : (
                      <p className="text-xs text-sell">Image unavailable</p>
                    )}
                  </figure>
                </div>

                <KycReview submissionId={s.id} />
              </li>
            ))}
          </ul>
        )}
    </main>
  );
}
