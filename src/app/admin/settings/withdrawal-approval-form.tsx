"use client";

import { useActionState } from "react";
import {
  setWithdrawalApprovalThresholdAction,
  type ApprovalThresholdState,
} from "../actions";

/**
 * The admin's withdrawal approval threshold (migration 0060). A withdrawal whose
 * total (amount + fee) is at or above this needs an admin to approve it before the
 * signer broadcasts; anything below auto-approves. requestWithdrawal reads it live,
 * so a new value applies to withdrawals requested after it's saved. Raise it as the
 * platform grows and larger legitimate withdrawals become routine; set 0 to require
 * approval on every withdrawal.
 */
export function WithdrawalApprovalForm({ threshold }: { threshold: number }) {
  const [state, formAction, pending] = useActionState<
    ApprovalThresholdState,
    FormData
  >(setWithdrawalApprovalThresholdAction, {});

  return (
    <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
      <div>
        <h2 className="text-sm font-medium text-ink">
          Withdrawal approval threshold
        </h2>
        <p className="mt-1 text-xs text-ink-faint">
          Withdrawals whose total (amount + fee) is at or above this amount need an
          admin to approve before they&rsquo;re sent; anything below is sent
          automatically. Raise it as your users grow and larger withdrawals become
          normal, or lower it for tighter oversight. Set 0 to review every
          withdrawal.
        </p>
      </div>

      <form action={formAction} className="mt-4 space-y-4">
        <label className="block max-w-xs">
          <span className="text-xs font-medium text-ink-soft">
            Auto-approve below
          </span>
          <div className="mt-1 flex items-center gap-2">
            <input
              name="threshold"
              type="text"
              inputMode="decimal"
              defaultValue={String(threshold)}
              placeholder="500"
              className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 font-amount text-sm text-ink"
            />
            <span className="text-sm text-ink-faint">USDT</span>
          </div>
        </label>

        <p className="text-xs text-ink-faint">
          A non-negative amount (up to 6 decimals), max 1,000,000 USDT.
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
            Approval threshold updated.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save threshold"}
        </button>
      </form>
    </section>
  );
}
