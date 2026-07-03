"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One ID photo (front or back). Opens the phone's rear camera directly via a
 * native capture input (reliable + high quality on mobile), with a "choose from
 * gallery" fallback, then shows a preview with a Retake option. Hands the chosen
 * File up through onCapture; the parent step gates "Continue" on it.
 */
export function IdCapture({
  side,
  onCapture,
}: {
  side: "front" | "back";
  onCapture: (file: File | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function handle(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("Please choose an image file.");
      return;
    }
    setErr(null);
    onCapture(file);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
  }

  function retake() {
    onCapture(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  }

  return (
    <div>
      {err && <p className="mb-2 text-sm text-state-disputed">{err}</p>}

      {preview ? (
        <div className="animate-rise">
          <div className="relative overflow-hidden rounded-2xl border border-paper-border bg-paper-sunken">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt={`${side} of ID`} className="w-full" />
            <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-buy px-2.5 py-1 text-xs font-semibold text-paper shadow-lg">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Captured
            </span>
          </div>
          <button
            type="button"
            onClick={retake}
            className="mt-3 w-full rounded-lg border border-paper-border px-4 py-2.5 text-sm font-medium text-ink-soft hover:bg-paper-sunken"
          >
            Retake photo
          </button>
        </div>
      ) : (
        <div className="animate-rise">
          <button
            type="button"
            onClick={() => camRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-paper-border bg-paper-sunken/60 px-6 py-12 text-center transition-colors hover:border-amber/60 hover:bg-paper-sunken"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber/25 bg-amber-wash text-amber">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
                <circle cx="8.5" cy="11" r="2" stroke="currentColor" strokeWidth="1.7" />
                <path d="M13 9h5M13 12h5M6.5 15.5c.4-1.2 1.4-2 2.5-2s2.1.8 2.5 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
            <span className="text-sm font-medium text-ink">
              Tap to photograph the {side}
            </span>
            <span className="text-xs text-ink-faint">
              Fit the whole card in frame · avoid glare
            </span>
          </button>

          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => camRef.current?.click()}
              className="w-full rounded-lg bg-amber px-4 py-3 text-base font-semibold text-paper hover:bg-amber-soft"
            >
              Take photo
            </button>
            <button
              type="button"
              onClick={() => galRef.current?.click()}
              className="w-full rounded-lg px-4 py-2 text-sm text-ink-muted hover:text-ink"
            >
              Choose from gallery
            </button>
          </div>
        </div>
      )}

      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => handle(e.target.files?.[0])}
      />
      <input
        ref={galRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => handle(e.target.files?.[0])}
      />
    </div>
  );
}
