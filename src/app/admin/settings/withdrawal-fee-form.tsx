"use client";

import { useActionState } from "react";
import { setWithdrawalFeeAction, type WithdrawalFeeState } from "../actions";

/**
 * The admin's flat withdrawal-fee control (migration 0045). Deducted from each
 * withdrawal so the user covers the on-chain gas (a TRC-20 send burns roughly
 * 6.5–13 TRX). requestWithdrawal reads this live and bakes it onto the row, so a
 * new value applies to withdrawals requested after it's saved. Set to 0 to make
 * withdrawals free (the platform then absorbs the gas).
 */
export function WithdrawalFeeForm({ fee }: { fee: string }) {
  const [state, formAction, pending] = useActionState<
    WithdrawalFeeState,
    FormData
  >(setWithdrawalFeeAction, {});

  return (
    <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
      <div>
        <h2 className="text-sm font-medium text-ink">Withdrawal fee</h2>
        <p className="mt-1 text-xs text-ink-faint">
          A flat USDT fee deducted from each withdrawal so the user covers the
          on-chain gas. The user sees it before confirming (&ldquo;you&rsquo;ll
          receive amount − fee&rdquo;) and the fee accrues to platform revenue. A
          TRC-20 send currently costs ~6.5–13 TRX (~$2), so ~1–2 USDT keeps you
          gas-neutral. Set 0 to make withdrawals free.
        </p>
      </div>

      <form action={formAction} className="mt-4 space-y-4">
        <label className="block max-w-xs">
          <span className="text-xs font-medium text-ink-soft">
            Fee per withdrawal
          </span>
          <div className="mt-1 flex items-center gap-2">
            <input
              name="fee"
              type="text"
              inputMode="decimal"
              defaultValue={fee}
              placeholder="1"
              className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 font-amount text-sm text-ink"
            />
            <span className="text-sm text-ink-faint">USDT</span>
          </div>
        </label>

        <p className="text-xs text-ink-faint">
          A non-negative amount (up to 6 decimals), max 100 USDT.
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
            Withdrawal fee updated.
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
