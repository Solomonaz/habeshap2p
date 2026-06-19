"use client";

import { useActionState, useState } from "react";
import {
  approveKycAction,
  rejectKycAction,
  type KycReviewState,
} from "../actions";

/**
 * Approve/reject controls for one pending identity submission. Approving flips
 * the account to APPROVED (unblocking trading); rejecting records a reason the
 * user sees and lets them resubmit. Both are two-step against fat-fingers, and
 * the server action + SQL re-verify the admin.
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

  const error = approveState.error ?? rejectState.error;

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
        <div className="flex gap-2">
          <form action={approveAction}>
            <input type="hidden" name="submissionId" value={submissionId} />
            <button
              type="submit"
              disabled={approving}
              className="rounded-md bg-buy px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-60"
            >
              {approving ? "Approving…" : "Approve"}
            </button>
          </form>
          <button
            type="button"
            onClick={() => setMode("reject")}
            className="rounded-md border border-sell/50 px-4 py-2 text-sm font-semibold text-sell hover:bg-sell-wash"
          >
            Reject
          </button>
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
