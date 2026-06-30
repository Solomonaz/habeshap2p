"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  approveKycAction,
  rejectKycAction,
  checkKycIdNumberAction,
  type KycReviewState,
  type KycIdCheckState,
} from "../actions";

/**
 * Approve/reject controls for one pending identity submission. To approve, the
 * admin reads the ID / passport number off the uploaded document and types it
 * here: as they type, the system checks whether that number is already verified
 * on another account and warns them so they can reject the duplicate. Approving
 * stores the number and flips the account to APPROVED (unblocking trading);
 * rejecting records a reason the user sees and lets them resubmit. The server
 * action + SQL re-verify the admin and re-block duplicates.
 */
export function KycReview({ submissionId }: { submissionId: string }) {
  const [approveState, approveAction, approving] = useActionState<
    KycReviewState,
    FormData
  >(approveKycAction, {});
  const [rejectState, rejectAction, rejecting] = useActionState<
    KycReviewState,
    FormData
  >(rejectKycAction, {});
  const [mode, setMode] = useState<"idle" | "reject">("idle");

  const [idNumber, setIdNumber] = useState("");
  const [check, setCheck] = useState<KycIdCheckState | null>(null);
  const [checking, setChecking] = useState(false);
  // Ignore responses from stale (superseded) keystrokes.
  const reqIdRef = useRef(0);

  // Debounced live duplicate check as the admin types the number.
  useEffect(() => {
    const value = idNumber.trim();
    if (value.length < 2) {
      setCheck(null);
      setChecking(false);
      return;
    }
    const myReq = ++reqIdRef.current;
    setChecking(true);
    const t = setTimeout(async () => {
      const res = await checkKycIdNumberAction(submissionId, value);
      if (reqIdRef.current !== myReq) return; // a newer keystroke won
      setCheck(res);
      setChecking(false);
    }, 400);
    return () => clearTimeout(t);
  }, [idNumber, submissionId]);

  const error = approveState.error ?? rejectState.error;
  const taken = check?.taken === true;
  const clear = check?.taken === false && idNumber.trim().length >= 2;
  const canApprove = idNumber.trim().length >= 2 && !taken && !approving;

  const inputClass =
    "w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm " +
    "text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none";

  return (
    <div className="mt-4 border-t border-paper-border pt-4">
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-sell"
        >
          {error}
        </p>
      )}

      {mode === "idle" ? (
        <div className="space-y-3">
          <form action={approveAction} className="space-y-2">
            <input type="hidden" name="submissionId" value={submissionId} />
            <div>
              <label
                htmlFor={`idnum-${submissionId}`}
                className="block text-xs font-medium text-ink-soft"
              >
                ID / passport number (read it off the document above)
              </label>
              <input
                id={`idnum-${submissionId}`}
                type="text"
                name="idNumber"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                placeholder="e.g. ETH-1234567"
                autoComplete="off"
                className={`mt-1 ${inputClass}`}
              />
              {checking && (
                <p className="mt-1 text-xs text-ink-faint">Checking…</p>
              )}
              {!checking && taken && (
                <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-sell">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                    <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                  </svg>
                  This ID number is already verified on another account — reject
                  this submission.
                </p>
              )}
              {!checking && clear && (
                <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-buy">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Not verified on any other account.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!canApprove}
                className="rounded-md bg-buy px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
              >
                {approving ? "Approving…" : "Approve"}
              </button>
              <button
                type="button"
                onClick={() => setMode("reject")}
                className="rounded-md border border-sell/50 px-4 py-2 text-sm font-semibold text-sell hover:bg-sell-wash"
              >
                Reject
              </button>
            </div>
          </form>
        </div>
      ) : (
        <form action={rejectAction} className="space-y-2">
          <input type="hidden" name="submissionId" value={submissionId} />
          <input
            type="text"
            name="reason"
            placeholder="Reason (shown to the user)"
            className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink focus:border-sell focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={rejecting}
              className="rounded-md bg-sell px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-60"
            >
              {rejecting ? "Rejecting…" : "Confirm reject"}
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              disabled={rejecting}
              className="rounded-md border border-paper-border px-4 py-2 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              Back
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
