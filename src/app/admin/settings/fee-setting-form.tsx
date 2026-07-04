"use client";

import { useActionState } from "react";
import { setPlatformFeeAction, type FeeState } from "../actions";

/**
 * The admin's per-trade commission control. The fee is entered as a percentage
 * (1 = 1%, 0.25 = 0.25%, 0 = disabled) plus an optional min/max USDT clamp.
 * Whatever is set here is what `order_release` skims into the platform's revenue
 * account on every successful P2P trade. Dispute rulings never charge a fee.
 */
export function FeeSettingForm({
  percent,
  sellerPercent,
  min,
  max,
}: {
  percent: string;
  sellerPercent: string;
  min: string;
  max: string | null;
}) {
  const [state, formAction, pending] = useActionState<FeeState, FormData>(
    setPlatformFeeAction,
    {},
  );

  return (
    <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-ink">Trade commission fees</h2>
          <p className="mt-1 text-xs text-ink-faint">
            Charged on a completed P2P trade when the seller releases escrow. The
            buyer fee comes out of the buyer&apos;s USDT; the seller fee comes out
            of the seller&apos;s balance. Set a percentage to 0 to disable it.
          </p>
        </div>
      </div>

      <form action={formAction} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-ink-soft">
              Buyer fee %
            </span>
            <div className="mt-1 flex items-center gap-2">
              <input
                name="percent"
                type="text"
                inputMode="decimal"
                defaultValue={percent}
                placeholder="0.25"
                className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink"
              />
              <span className="text-sm text-ink-faint">%</span>
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-soft">
              Seller fee %
            </span>
            <div className="mt-1 flex items-center gap-2">
              <input
                name="seller_percent"
                type="text"
                inputMode="decimal"
                defaultValue={sellerPercent}
                placeholder="0"
                className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink"
              />
              <span className="text-sm text-ink-faint">%</span>
            </div>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-ink-soft">
              Minimum fee
            </span>
            <div className="mt-1 flex items-center gap-2">
              <input
                name="min"
                type="text"
                inputMode="decimal"
                defaultValue={min === "0" ? "" : min}
                placeholder="0"
                className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink"
              />
              <span className="text-sm text-ink-faint">USDT</span>
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-ink-soft">
              Maximum fee
            </span>
            <div className="mt-1 flex items-center gap-2">
              <input
                name="max"
                type="text"
                inputMode="decimal"
                defaultValue={max ?? ""}
                placeholder="no cap"
                className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink"
              />
              <span className="text-sm text-ink-faint">USDT</span>
            </div>
          </label>
        </div>

        <p className="text-xs text-ink-faint">
          The min/max clamp applies to the <b>buyer</b> fee. Leave minimum blank
          for no floor, maximum blank for no cap. Fees round to 6 decimals and
          never exceed the trade amount.
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
            Commission fee updated.
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
