"use client";

import { useActionState, useState } from "react";
import {
  reconcileWithdrawalSentAction,
  reconcileWithdrawalRefundAction,
  type WithdrawalReviewState,
} from "../actions";

/**
 * Resolution controls for a stuck (SENDING) withdrawal. The admin checks the
 * chain first, then either confirms it sent (with the verified tx hash → debits
 * the hold) or confirms it never broadcast (→ refunds the hold). Both are
 * two-step to guard against a mistaken click, and the server action + SQL
 * re-verify the admin. Picking wrong here moves real money, so the copy is blunt.
 */
export function WithdrawalReconcile({
  withdrawalId,
  amountUsdt,
  defaultTxHash,
}: {
  withdrawalId: string;
  amountUsdt: string;
  defaultTxHash?: string | null;
}) {
  const [sentState, sentAction, marking] = useActionState<
    WithdrawalReviewState,
    FormData
  >(reconcileWithdrawalSentAction, {});
  const [refundState, refundAction, refunding] = useActionState<
    WithdrawalReviewState,
    FormData
  >(reconcileWithdrawalRefundAction, {});
  const [mode, setMode] = useState<"idle" | "sent" | "refund">("idle");

  const error = sentState.error ?? refundState.error;

  return (
    <div className="mt-3 border-t border-state-disputed/30 pt-3">
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-sell"
        >
          {error}
        </p>
      )}

      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("sent")}
            className="rounded-md bg-buy px-4 py-2 text-sm font-semibold text-paper hover:opacity-90"
          >
            It was sent →
          </button>
          <button
            type="button"
            onClick={() => setMode("refund")}
            className="rounded-md border border-sell/50 px-4 py-2 text-sm font-semibold text-sell hover:bg-sell-wash"
          >
            It never sent — refund
          </button>
        </div>
      )}

      {mode === "sent" && (
        <form action={sentAction} className="space-y-2">
          <input type="hidden" name="withdrawalId" value={withdrawalId} />
          <p className="text-xs text-ink-muted">
            Confirm only after you&apos;ve found the transfer on the explorer.
            This debits the {amountUsdt} USDT hold — the funds are treated as gone.
          </p>
          <input
            type="text"
            name="txHash"
            defaultValue={defaultTxHash ?? ""}
            placeholder="On-chain tx hash"
            className="w-full break-all rounded-md border border-paper-border bg-paper px-3 py-2 font-amount text-sm text-ink focus:border-buy focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={marking}
              className="rounded-md bg-buy px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-60"
            >
              {marking ? "Saving…" : "Confirm sent (debits funds)"}
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              disabled={marking}
              className="rounded-md border border-paper-border px-4 py-2 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              Back
            </button>
          </div>
        </form>
      )}

      {mode === "refund" && (
        <form action={refundAction} className="space-y-2">
          <input type="hidden" name="withdrawalId" value={withdrawalId} />
          <p className="text-xs text-ink-muted">
            Confirm only if NO transfer for this withdrawal exists on-chain. This
            returns the {amountUsdt} USDT to the user&apos;s available balance.
          </p>
          <input
            type="text"
            name="reason"
            placeholder="Note (optional, for the audit log)"
            className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink focus:border-sell focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={refunding}
              className="rounded-md bg-sell px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-60"
            >
              {refunding ? "Refunding…" : "Confirm refund (returns funds)"}
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              disabled={refunding}
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
