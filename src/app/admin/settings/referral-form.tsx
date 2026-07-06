"use client";

import { useActionState } from "react";
import { setReferralBpsAction, type ReferralState } from "../actions";

/**
 * The referral reward rate (migration 0050): the share of the platform fee that
 * goes to a user's referrer on each of their referral's completed trades. It's
 * self-funding — paid out of fees already earned — so 20% here keeps 80% of the
 * fee. Set 0 to turn the referral program off.
 */
export function ReferralForm({
  percent,
  maxTrades,
}: {
  percent: string;
  maxTrades: number;
}) {
  const [state, formAction, pending] = useActionState<ReferralState, FormData>(
    setReferralBpsAction,
    {},
  );

  return (
    <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
      <div>
        <h2 className="text-sm font-medium text-ink">Referral reward</h2>
        <p className="mt-1 text-xs text-ink-faint">
          Share of the <b>platform trade fee</b> paid to whoever referred a
          trader, on each of their completed trades. Comes out of the fee you
          already collect (self-funding) and is credited as internal balance. Set
          0 to disable referrals.
        </p>
      </div>

      <form action={formAction} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-ink-soft">
              Reward rate
            </span>
            <div className="mt-1 flex items-center gap-2">
              <input
                name="percent"
                type="text"
                inputMode="decimal"
                defaultValue={percent}
                placeholder="20"
                className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink"
              />
              <span className="text-sm text-ink-faint">% of fee</span>
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-soft">
              Reward window
            </span>
            <div className="mt-1 flex items-center gap-2">
              <input
                name="max_trades"
                type="text"
                inputMode="numeric"
                defaultValue={String(maxTrades)}
                placeholder="10"
                className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink"
              />
              <span className="whitespace-nowrap text-sm text-ink-faint">
                trades
              </span>
            </div>
            <span className="mt-1 block text-xs text-ink-faint">
              A referee&apos;s first N trades earn their referrer. 0 = unlimited.
            </span>
          </label>
        </div>

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
            Referral rate updated.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save rate"}
        </button>
      </form>
    </section>
  );
}
