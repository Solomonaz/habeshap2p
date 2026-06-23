"use client";

import { useActionState } from "react";
import { setOrderTtlAction, type OrderTtlState } from "../actions";

/**
 * The admin's order-payment-window control. This is how long a buyer has to mark
 * an order paid before it becomes eligible for auto-cancel (the cron sweep that
 * returns the seller's escrow). order_create reads this live, so a new value
 * applies to every order opened after it's saved — open orders keep the deadline
 * they were created with.
 */
export function OrderWindowForm({ minutes }: { minutes: number }) {
  const [state, formAction, pending] = useActionState<OrderTtlState, FormData>(
    setOrderTtlAction,
    {},
  );

  return (
    <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
      <div>
        <h2 className="text-sm font-medium text-ink">Order payment window</h2>
        <p className="mt-1 text-xs text-ink-faint">
          How long a buyer has to pay before an unpaid order is automatically
          cancelled and the seller&apos;s escrow is released back.
        </p>
      </div>

      <form action={formAction} className="mt-4 space-y-4">
        <label className="block max-w-xs">
          <span className="text-xs font-medium text-ink-soft">
            Payment window
          </span>
          <div className="mt-1 flex items-center gap-2">
            <input
              name="minutes"
              type="text"
              inputMode="numeric"
              defaultValue={String(minutes)}
              placeholder="15"
              className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink"
            />
            <span className="text-sm text-ink-faint">minutes</span>
          </div>
        </label>

        <p className="text-xs text-ink-faint">
          Must be a whole number of minutes between 1 and 1440 (24 hours).
        </p>

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
            Payment window updated.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save window"}
        </button>
      </form>
    </section>
  );
}
