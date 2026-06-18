"use client";

import { useActionState } from "react";
import { formatUsdt } from "@/lib/money";
import { requestWithdrawalAction, type WithdrawState } from "./actions";

/**
 * On-chain withdrawal request. Moves available balance into a hold and queues
 * it; amounts at or above the approval threshold are flagged here so the user
 * knows an admin must sign off before it's broadcast (rule #6). The SQL re-checks
 * the balance and decides PENDING_APPROVAL vs APPROVED — this is just the form.
 */
export function WithdrawForm({
  available,
  networkLabel,
  approvalThreshold,
}: {
  available: string;
  networkLabel: string;
  approvalThreshold: number;
}) {
  const [state, formAction, pending] = useActionState<WithdrawState, FormData>(
    requestWithdrawalAction,
    {},
  );

  return (
    <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
      <h2 className="text-sm font-medium text-ink">Withdraw USDT</h2>
      <p className="mt-1 text-xs text-ink-faint">
        Send to a {networkLabel} address. Available:{" "}
        <span className="font-amount text-ink-muted">
          {formatUsdt(available)}
        </span>{" "}
        USDT. Withdrawals of {approvalThreshold} USDT or more need admin review
        before they&apos;re sent.
      </p>

      {state.error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-sell"
        >
          {state.error}
        </p>
      )}
      {state.ok && (
        <p
          role="status"
          className="mt-3 rounded-md border border-buy/40 bg-buy-wash px-3 py-2 text-sm text-buy"
        >
          Withdrawal requested. Track its status below.
        </p>
      )}

      <form action={formAction} className="mt-3 space-y-3">
        <div>
          <label
            htmlFor="toAddress"
            className="block text-xs text-ink-muted"
          >
            Destination address
          </label>
          <input
            id="toAddress"
            type="text"
            name="toAddress"
            placeholder="T…"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full rounded-md border border-paper-border bg-paper px-3 py-2 font-amount text-sm text-ink focus:border-amber focus:outline-none"
          />
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="amount" className="block text-xs text-ink-muted">
              Amount (USDT)
            </label>
            <input
              id="amount"
              type="text"
              name="amount"
              inputMode="decimal"
              placeholder="0.00"
              className="mt-1 w-full rounded-md border border-paper-border bg-paper px-3 py-2 font-amount text-sm text-ink focus:border-amber focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-amber px-4 py-2 text-sm font-semibold text-paper hover:bg-amber-soft disabled:opacity-60"
          >
            {pending ? "Requesting…" : "Withdraw"}
          </button>
        </div>
      </form>
    </section>
  );
}
