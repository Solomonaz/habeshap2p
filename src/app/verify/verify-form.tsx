"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { submitVerification } from "./actions";

const KYC_BUCKET = "kyc";
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per image

/**
 * Uploads the two images straight to the private `kyc` bucket from the browser
 * (the storage RLS only admits objects under the signed-in user's folder), then
 * hands the resulting object paths to the server action that files the
 * submission. Keeping the upload client-side means the large binaries never pass
 * through a server action body.
 *
 * The liveness selfie is captured live via the camera (getUserMedia) rather than
 * a file picker, so the user can't upload a saved photo — they must take one now.
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
      setError("Please attach a photo of your ID.");
      return;
    }
    if (!liveness) {
      setError("Please take your liveness selfie with the camera.");
      return;
    }
    if (idDoc.size > MAX_BYTES || liveness.size > MAX_BYTES) {
      setError("Each image must be under 8 MB.");
      return;
    }

    setBusy(true);
    try {
      const [idPath, livePath] = await Promise.all([
        uploadImage(idDoc),
        uploadImage(liveness),
      ]);

      const fd = new FormData();
      fd.set("idDocumentPath", idPath);
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
        <label htmlFor="idDoc" className="block text-sm text-ink-soft">
          Government-issued ID
        </label>
        <p className="mt-0.5 text-xs text-ink-faint">
          A clear photo of your passport, national ID, or driver&apos;s licence.
        </p>
        <input
          id="idDoc"
          type="file"
          accept="image/*"
          capture="environment"
          required
          onChange={(e) => setIdDoc(e.target.files?.[0] ?? null)}
          className={`mt-1 ${fileClass}`}
        />
      </div>

      <div>
        <span className="block text-sm text-ink-soft">Liveness selfie</span>
        <p className="mt-0.5 text-xs text-ink-faint">
          Open your camera and take a selfie now. Look straight at the camera in
          good light.
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

/** Turns a getUserMedia rejection into something the user can act on. */
function cameraErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
      case "SecurityError":
        return (
          "We couldn't access this device's camera. Please open this page on " +
          "your mobile phone and take the selfie there."
        );
      case "NotFoundError":
      case "OverconstrainedError":
        return "No camera was found on this device.";
      case "NotReadableError":
        return (
          "The camera is in use by another app. Close it (Zoom, Teams, " +
          "another browser tab) and try again."
        );
    }
  }
  return "Couldn't open the camera. Allow camera access and try again.";
}

type CapturePhase = "idle" | "live" | "captured";

/**
 * Live selfie capture. Opens the front camera via getUserMedia, shows a preview,
 * and turns a captured frame into a JPEG File handed back through onCapture.
 * Requires a secure context (https or localhost) — browsers block camera access
 * otherwise, which we surface as an error.
 */
function LivenessCapture({ onCapture }: { onCapture: (file: File | null) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<CapturePhase>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  // Stop the camera and revoke the preview object URL on unmount.
  useEffect(() => {
    return () => {
      stopStream();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function openCamera() {
    setCamError(null);
    if (!window.isSecureContext) {
      setCamError(
        "The camera only works over a secure connection (https). Open this " +
          "page via https or localhost.",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError("Camera access isn't supported on this device or browser.");
      return;
    }
    try {
      // Prefer the front camera, but fall back to any camera: many desktop
      // webcams report no facing mode and reject the "user" constraint.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
      } catch (constraintErr) {
        if (
          constraintErr instanceof DOMException &&
          (constraintErr.name === "OverconstrainedError" ||
            constraintErr.name === "NotFoundError")
        ) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } else {
          throw constraintErr;
        }
      }
      streamRef.current = stream;
      setPhase("live");
      // The <video> mounts with this phase; attach the stream after paint.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch (err) {
      setCamError(cameraErrorMessage(err));
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCamError("Couldn't capture the photo. Try again.");
          return;
        }
        stopStream();
        const file = new File([blob], "liveness.jpg", { type: "image/jpeg" });
        onCapture(file);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(blob));
        setPhase("captured");
      },
      "image/jpeg",
      0.9,
    );
  }

  function retake() {
    onCapture(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    void openCamera();
  }

  const frameClass =
    "mt-2 w-full max-w-xs overflow-hidden rounded-md border border-paper-border bg-paper-sunken";
  const btn =
    "rounded-md bg-amber px-4 py-2 text-sm font-medium text-paper hover:bg-amber-soft";
  const ghostBtn =
    "rounded-md border border-paper-border px-4 py-2 text-sm text-ink-soft hover:bg-paper-sunken";

  return (
    <div className="mt-1">
      {camError && (
        <p className="mb-2 text-sm text-state-disputed">{camError}</p>
      )}

      {phase === "idle" && (
        <button type="button" onClick={openCamera} className={btn}>
          Open camera
        </button>
      )}

      {phase === "live" && (
        <div>
          <div className={frameClass}>
            {/* Mirror the preview so it reads like a mirror to the user. */}
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full -scale-x-100"
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={capture} className={btn}>
              Take photo
            </button>
            <button
              type="button"
              onClick={() => {
                stopStream();
                setPhase("idle");
              }}
              className={ghostBtn}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === "captured" && previewUrl && (
        <div>
          <div className={frameClass}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Liveness selfie" className="w-full" />
          </div>
          <button
            type="button"
            onClick={retake}
            className={`mt-2 ${ghostBtn}`}
          >
            Retake
          </button>
        </div>
      )}
    </div>
  );
}
