"use client";

import { useActionState } from "react";
import {
  setInternalTransferFeeAction,
  type TransferFeeState,
} from "../actions";

/**
 * The admin's internal-transfer fee (migration 0049) — a flat USDT fee on a
 * user-to-user transfer by HabeshaP2P ID, deducted from the amount (recipient
 * gets amount − fee). Set 0 to keep internal transfers free.
 */
export function TransferFeeForm({ fee }: { fee: string }) {
  const [state, formAction, pending] = useActionState<TransferFeeState, FormData>(
    setInternalTransferFeeAction,
    {},
  );

  return (
    <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
      <div>
        <h2 className="text-sm font-medium text-ink">Internal transfer fee</h2>
        <p className="mt-1 text-xs text-ink-faint">
          Flat fee on a user-to-user transfer by HabeshaP2P ID. Deducted from the
          amount — the recipient receives amount − fee. Set 0 to keep transfers
          free.
        </p>
      </div>

      <form action={formAction} className="mt-4 space-y-4">
        <label className="block max-w-xs">
          <span className="text-xs font-medium text-ink-soft">Fee per transfer</span>
          <div className="mt-1 flex items-center gap-2">
            <input
              name="fee"
              type="text"
              inputMode="decimal"
              defaultValue={fee}
              placeholder="0"
              className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 font-amount text-sm text-ink"
            />
            <span className="text-sm text-ink-faint">USDT</span>
          </div>
        </label>

        {state.error && (
          <p
            role="alert"
            className="rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-sell"
          >
            {state.error}
          </p>
        )}
        {state.ok && (
          <p
            role="status"
            className="rounded-md border border-buy/40 bg-buy-wash px-3 py-2 text-sm text-buy"
          >
            Transfer fee updated.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save fee"}
        </button>
      </form>
    </section>
  );
}
