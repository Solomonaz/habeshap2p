"use client";

import { useActionState } from "react";
import { setReleaseWindowAction, type ReleaseWindowState } from "../actions";

/**
 * The admin's seller-release-window control (migration 0042). This is how long a
 * seller has to confirm the ETB and release the USDT AFTER the buyer marks paid.
 * order_mark_paid stamps a fresh deadline from this value, so it applies to every
 * order marked paid after it's saved — independent of the unpaid payment window.
 * A seller who misses it has their escrow frozen and an admin dispute opened.
 */
export function ReleaseWindowForm({ minutes }: { minutes: number }) {
  const [state, formAction, pending] = useActionState<
    ReleaseWindowState,
    FormData
  >(setReleaseWindowAction, {});

  return (
    <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
      <div>
        <h2 className="text-sm font-medium text-ink">Seller release window</h2>
        <p className="mt-1 text-xs text-ink-faint">
          How long a seller has to confirm payment and release the USDT after the
          buyer marks an order paid. The clock starts fresh at that moment — a
          seller who misses it has their escrow frozen and the order auto-disputed.
        </p>
      </div>

      <form action={formAction} className="mt-4 space-y-4">
        <label className="block max-w-xs">
          <span className="text-xs font-medium text-ink-soft">
            Release window
          </span>
          <div className="mt-1 flex items-center gap-2">
            <input
              name="minutes"
              type="text"
              inputMode="numeric"
              defaultValue={String(minutes)}
              placeholder="30"
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
            Release window updated.
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
