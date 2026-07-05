"use client";

import { useActionState, useState } from "react";
import { formatUsdt } from "@/lib/money";
import { requestWithdrawalAction, type WithdrawState } from "./actions";

/**
 * On-chain withdrawal request. Moves available balance into a hold and queues
 * it; amounts at or above the approval threshold are flagged here so the user
 * knows an admin must sign off before it's broadcast (rule #6). The SQL re-checks
 * the balance and decides PENDING_APPROVAL vs APPROVED — this is just the form.
 * A flat fee (fee) is deducted so the user covers on-chain gas; we show the live
 * "you'll receive" (amount − fee), and the server re-derives it authoritatively.
 */
export function WithdrawForm({
  available,
  networkLabel,
  approvalThreshold,
  fee,
}: {
  available: string;
  networkLabel: string;
  approvalThreshold: number;
  fee: string;
}) {
  const [state, formAction, pending] = useActionState<WithdrawState, FormData>(
    requestWithdrawalAction,
    {},
  );
  const [amount, setAmount] = useState("");
  const feeNum = Number(fee) || 0;
  const availNum = Number(available) || 0;
  // The user enters the amount they want to SEND; the fee is charged on top, so
  // the total taken from their balance is (send + fee).
  const amtNum = Number(amount);
  const total =
    Number.isFinite(amtNum) && amtNum > 0 ? amtNum + feeNum : null;
  const insufficient = total !== null && total > availNum + 1e-9;

  return (
    <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
      <h2 className="text-sm font-medium text-ink">Withdraw USDT</h2>
      <p className="mt-1 text-xs text-ink-faint">
        Send to a {networkLabel} address. Available:{" "}
        <span className="font-amount text-ink-muted">
          {formatUsdt(available)}
        </span>{" "}
        USDT. A {formatUsdt(fee)} USDT network fee is added on top — the full
        amount you enter is sent, and your balance must cover the amount plus the
        fee. Withdrawals of {approvalThreshold} USDT or more need admin review
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
              Amount to send (USDT)
            </label>
            <input
              id="amount"
              type="text"
              name="amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-md border border-paper-border bg-paper px-3 py-2 font-amount text-sm text-ink focus:border-amber focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={pending || insufficient || amount.trim() === ""}
            className="rounded-md bg-amber px-4 py-2 text-sm font-semibold text-paper hover:bg-amber-soft disabled:opacity-60"
          >
            {pending ? "Requesting…" : "Withdraw"}
          </button>
        </div>

        {amount.trim() !== "" && (
          <div className="rounded-md bg-paper-sunken px-3 py-2 text-xs">
            <div className="flex items-center justify-between text-ink-muted">
              <span>Amount sent</span>
              <span className="font-amount">
                {Number.isFinite(amtNum) && amtNum > 0
                  ? `${formatUsdt(String(amtNum))} USDT`
                  : "—"}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-ink-muted">
              <span>Network fee</span>
              <span className="font-amount">+{formatUsdt(fee)} USDT</span>
            </div>
            <div className="mt-1 flex items-center justify-between font-medium text-ink">
              <span>Total deducted</span>
              <span className="font-amount">
                {total !== null ? `${formatUsdt(String(total))} USDT` : "—"}
              </span>
            </div>
            {insufficient && (
              <p className="mt-1 text-sell">
                You need {formatUsdt(String(total))} USDT (amount + fee) but only
                have {formatUsdt(available)} USDT.
              </p>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
