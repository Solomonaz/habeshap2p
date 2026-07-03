"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { submitVerification } from "./actions";
import { LivenessCapture } from "./liveness-capture";
import { IdCapture } from "./id-capture";

const KYC_BUCKET = "kyc";

// One focused screen per step (Persona-style), so the flow reads clearly on a
// phone instead of dumping every field at once. "intro" isn't counted in the
// progress bar; the four capture/detail steps are.
type Step = "intro" | "name" | "front" | "back" | "selfie" | "review";
const STEPS: Step[] = ["intro", "name", "front", "back", "selfie", "review"];

/**
 * Guided identity-verification wizard. Uploads the images straight to the private
 * `kyc` bucket from the browser (storage RLS only admits the signed-in user's
 * folder) and hands the object paths to the submit action. Walks the user through
 * requirements → name → front of ID → back of ID → live selfie → review.
 */
export function VerifyForm({
  userId,
  defaultFullName,
  rejectionReason,
}: {
  userId: string;
  defaultFullName: string;
  rejectionReason?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [stepIdx, setStepIdx] = useState(0);
  const [fullName, setFullName] = useState(defaultFullName);
  const [idDoc, setIdDoc] = useState<File | null>(null);
  const [idBack, setIdBack] = useState<File | null>(null);
  const [liveness, setLiveness] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const step = STEPS[stepIdx];

  // Preview URLs for the review screen (revoked on change/unmount).
  const frontUrl = useMemo(() => (idDoc ? URL.createObjectURL(idDoc) : null), [idDoc]);
  const backUrl = useMemo(() => (idBack ? URL.createObjectURL(idBack) : null), [idBack]);
  const selfieUrl = useMemo(
    () => (liveness ? URL.createObjectURL(liveness) : null),
    [liveness],
  );
  useEffect(
    () => () => {
      [frontUrl, backUrl, selfieUrl].forEach((u) => u && URL.revokeObjectURL(u));
    },
    [frontUrl, backUrl, selfieUrl],
  );

  function go(next: Step) {
    setError(null);
    setStepIdx(STEPS.indexOf(next));
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }
  function goBack() {
    setError(null);
    setStepIdx((i) => Math.max(0, i - 1));
  }

  async function uploadImage(file: File): Promise<string> {
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(KYC_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
    return path;
  }

  async function onSubmit() {
    setError(null);
    if (!idDoc || !idBack || !liveness || fullName.trim().length < 2) {
      setError("Something's missing — please complete every step.");
      return;
    }
    setBusy(true);
    try {
      const [idPath, idBackPath, livePath] = await Promise.all([
        uploadImage(idDoc),
        uploadImage(idBack),
        uploadImage(liveness),
      ]);
      const fd = new FormData();
      fd.set("idDocumentPath", idPath);
      fd.set("idDocumentBackPath", idBackPath);
      fd.set("livenessPath", livePath);
      fd.set("fullName", fullName.trim());
      const res = await submitVerification({}, fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  }

  const pct = (stepIdx / (STEPS.length - 1)) * 100;
  const primaryBtn =
    "w-full rounded-xl bg-amber px-4 py-3.5 text-base font-semibold text-paper transition-colors hover:bg-amber-soft disabled:opacity-50";

  return (
    <div className="mx-auto flex min-h-[74vh] max-w-md flex-col">
      {/* Header: back + title + progress */}
      <div className="flex items-center justify-between">
        {stepIdx > 0 ? (
          <button
            type="button"
            onClick={goBack}
            aria-label="Back"
            className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-paper-sunken hover:text-ink"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span className="h-9 w-9" />
        )}
        <span className="text-sm font-semibold text-ink">Verify identity</span>
        <span className="w-9 text-right text-xs text-ink-faint">
          {stepIdx > 0 ? `${stepIdx}/${STEPS.length - 1}` : ""}
        </span>
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-paper-sunken">
        <div
          className="h-1 rounded-full bg-amber transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Animated step body */}
      <div key={step} className="animate-rise flex flex-1 flex-col pt-7">
        {step === "intro" && (
          <>
            <StepIcon>
              <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9.5 12l1.8 1.8L15 10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </StepIcon>
            <StepTitle>Verify your identity</StepTitle>
            <StepText>
              A quick check keeps scammers out. It takes about 2 minutes and only
              our review team ever sees your documents.
            </StepText>

            {rejectionReason && (
              <div className="mt-4 rounded-xl border border-sell/40 bg-sell-wash px-4 py-3 text-sm text-state-disputed">
                <p className="font-medium">Your last submission was rejected</p>
                <p className="mt-0.5 text-state-disputed/90">{rejectionReason}</p>
              </div>
            )}

            <ul className="mt-5 space-y-3">
              {[
                "A government ID — national ID, passport, or driver's licence",
                "Both the front and back, with all four corners visible",
                "Good lighting, text sharp and readable, no glare",
                "A quick selfie so we can match your face to the ID",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm text-ink-soft">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-wash text-amber">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  {t}
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-8">
              <button type="button" onClick={() => go("name")} className={primaryBtn}>
                Get started
              </button>
            </div>
          </>
        )}

        {step === "name" && (
          <>
            <StepIcon>
              <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.7" />
              <path d="M5 20a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </StepIcon>
            <StepTitle>Your legal name</StepTitle>
            <StepText>Enter it exactly as it appears on your ID.</StepText>
            <input
              type="text"
              autoFocus
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full legal name"
              className="mt-5 w-full rounded-xl border border-paper-border bg-paper-raised px-4 py-3 text-base text-ink placeholder:text-ink-faint focus-visible:border-amber focus-visible:outline-none"
            />
            <div className="mt-auto pt-8">
              <button
                type="button"
                disabled={fullName.trim().length < 2}
                onClick={() => go("front")}
                className={primaryBtn}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === "front" && (
          <>
            <StepTitle>Front of your ID</StepTitle>
            <StepText>
              Photograph the front of your government ID. Fit the whole card in
              frame — every corner visible, text sharp, no glare.
            </StepText>
            <div className="mt-5">
              <IdCapture side="front" onCapture={setIdDoc} />
            </div>
            <div className="mt-auto pt-8">
              <button
                type="button"
                disabled={!idDoc}
                onClick={() => go("back")}
                className={primaryBtn}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === "back" && (
          <>
            <StepTitle>Back of your ID</StepTitle>
            <StepText>
              Now the back of the same ID. Same rules — whole card in frame,
              readable, no glare.
            </StepText>
            <div className="mt-5">
              <IdCapture side="back" onCapture={setIdBack} />
            </div>
            <div className="mt-auto pt-8">
              <button
                type="button"
                disabled={!idBack}
                onClick={() => go("selfie")}
                className={primaryBtn}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === "selfie" && (
          <>
            <StepTitle>Take a selfie</StepTitle>
            <StepText>
              Open your camera and follow the guide: center your face, then turn
              your head left and right. It captures automatically.
            </StepText>
            <div className="mt-5">
              <LivenessCapture onCapture={setLiveness} />
            </div>
            <div className="mt-auto pt-8">
              <button
                type="button"
                disabled={!liveness}
                onClick={() => go("review")}
                className={primaryBtn}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === "review" && (
          <>
            <StepTitle>Review &amp; submit</StepTitle>
            <StepText>Check everything looks right, then send it for review.</StepText>

            <dl className="mt-5 space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-paper-sunken px-4 py-3">
                <dt className="text-sm text-ink-muted">Name</dt>
                <dd className="text-sm font-medium text-ink">{fullName.trim()}</dd>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Front", url: frontUrl },
                  { label: "Back", url: backUrl },
                  { label: "Selfie", url: selfieUrl },
                ].map((t) => (
                  <div key={t.label}>
                    <div className="aspect-[4/3] overflow-hidden rounded-lg border border-paper-border bg-paper-sunken">
                      {t.url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.url} alt={t.label} className="h-full w-full object-cover" />
                      )}
                    </div>
                    <p className="mt-1 text-center text-xs text-ink-faint">{t.label}</p>
                  </div>
                ))}
              </div>
            </dl>

            <p className="mt-4 text-xs text-ink-faint">
              By submitting, you confirm these documents are genuine and belong to
              you.
            </p>

            {error && (
              <p role="alert" className="mt-4 rounded-xl border border-sell/40 bg-sell-wash px-4 py-3 text-sm text-state-disputed">
                {error}
              </p>
            )}

            <div className="mt-auto pt-8">
              <button type="button" disabled={busy} onClick={onSubmit} className={primaryBtn}>
                {busy ? "Submitting…" : "Submit for review"}
              </button>
            </div>
          </>
        )}

        {/* Errors on capture steps surface here (rare — most are inline). */}
        {error && step !== "review" && (
          <p role="alert" className="mt-4 text-sm text-state-disputed">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function StepIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber/25 bg-amber-wash text-amber">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
        {children}
      </svg>
    </span>
  );
}

function StepTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink">{children}</h1>;
}

function StepText({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-sm leading-relaxed text-ink-soft">{children}</p>;
}
