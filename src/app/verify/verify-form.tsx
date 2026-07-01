"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { submitVerification } from "./actions";
import { LivenessCapture } from "./liveness-capture";

const KYC_BUCKET = "kyc";
// const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per image

/**
 * Uploads the two images straight to the private `kyc` bucket from the browser
 * (the storage RLS only admits objects under the signed-in user's folder), then
 * hands the resulting object paths to the server action that files the
 * submission. Keeping the upload client-side means the large binaries never pass
 * through a server action body.
 *
 * The liveness selfie is captured live via the camera (getUserMedia) with an
 * on-device face guide (see LivenessCapture), so the user can't upload a saved
 * photo — they must take one now.
 */
export function VerifyForm({
  userId,
  defaultFullName,
}: {
  userId: string;
  defaultFullName: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [fullName, setFullName] = useState(defaultFullName);
  const [idDoc, setIdDoc] = useState<File | null>(null);
  const [idBack, setIdBack] = useState<File | null>(null);
  const [liveness, setLiveness] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function uploadImage(file: File): Promise<string> {
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(KYC_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
    return path;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (fullName.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }
    if (!idDoc) {
      setError("Please attach a photo of the FRONT of your ID.");
      return;
    }
    if (!idBack) {
      setError("Please attach a photo of the BACK of your ID.");
      return;
    }
    if (!liveness) {
      setError("Please take your liveness selfie with the camera.");
      return;
    }
    // if (idDoc.size > MAX_BYTES || liveness.size > MAX_BYTES) {
    //   setError("Each image must be under 8 MB.");
    //   return;
    // }

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

  const inputClass =
    "w-full rounded-md border border-paper-border bg-paper-raised px-3 py-2 " +
    "text-ink placeholder:text-ink-faint focus-visible:border-amber";
  const fileClass =
    "w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm " +
    "text-ink-soft file:mr-3 file:rounded-md file:border-0 file:bg-amber " +
    "file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-paper";

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-5">
      <div>
        <label htmlFor="fullName" className="block text-sm text-ink-soft">
          Full legal name (as on your ID)
        </label>
        <input
          id="fullName"
          type="text"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className={`mt-1 ${inputClass}`}
        />
      </div>

      <div>
        <span className="block text-sm text-ink-soft">Government-issued ID</span>
        <p className="mt-0.5 text-xs text-ink-faint">
          Clear photos of the FRONT and BACK of your national ID, passport, or
          driver&apos;s licence. Make sure all text is readable and not cut off.
        </p>
        {/* No `capture` attribute: on mobile that would force the camera open
            and prevent choosing an existing ID photo. A plain file picker lets
            the user pick from gallery/files OR snap a new one. */}
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-ink-muted">Front</span>
            <input
              type="file"
              accept="image/*"
              required
              onChange={(e) => setIdDoc(e.target.files?.[0] ?? null)}
              className={`mt-1 ${fileClass}`}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-muted">Back</span>
            <input
              type="file"
              accept="image/*"
              required
              onChange={(e) => setIdBack(e.target.files?.[0] ?? null)}
              className={`mt-1 ${fileClass}`}
            />
          </label>
        </div>
      </div>

      <div>
        <span className="block text-sm text-ink-soft">Liveness selfie</span>
        <p className="mt-0.5 text-xs text-ink-faint">
          Open your camera and follow the on-screen guide: center your face, then
          turn your head left and right. It captures automatically.
        </p>
        <LivenessCapture onCapture={setLiveness} />
      </div>

      {error && <p className="text-sm text-state-disputed">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-amber px-4 py-2 font-medium text-paper transition-colors hover:bg-amber-soft disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Submit for review"}
      </button>
    </form>
  );
}
