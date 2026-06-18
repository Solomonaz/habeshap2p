"use client";

import { useActionState, useState } from "react";
import {
  approveWithdrawalAction,
  rejectWithdrawalAction,
  type WithdrawalReviewState,
} from "../actions";

/**
 * Approve/reject controls for one pending withdrawal. Approving only flags it
 * APPROVED — the cron signer is what actually broadcasts (rule #6). Rejecting
 * refunds the held funds in SQL. Both are two-step to guard against fat-fingers,
 * and the server action + SQL re-verify the admin.
 */
export function WithdrawalReview({
  withdrawalId,
  amountUsdt,
}: {
  withdrawalId: string;
  amountUsdt: string;
}) {
  const [approveState, approveAction, approving] = useActionState<
    WithdrawalReviewState,
    FormData
  >(approveWithdrawalAction, {});
  const [rejectState, rejectAction, rejecting] = useActionState<
    WithdrawalReviewState,
    FormData
  >(rejectWithdrawalAction, {});
  const [mode, setMode] = useState<"idle" | "reject">("idle");

  const error = approveState.error ?? rejectState.error;

  return (
    <div className="mt-3 border-t border-paper-border pt-3">
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
            <input type="hidden" name="withdrawalId" value={withdrawalId} />
            <button
              type="submit"
              disabled={approving}
              className="rounded-md bg-buy px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-60"
            >
              {approving ? "Approving…" : `Approve ${amountUsdt} USDT`}
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
          <input type="hidden" name="withdrawalId" value={withdrawalId} />
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
              {rejecting ? "Rejecting…" : "Confirm reject (refunds funds)"}
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
