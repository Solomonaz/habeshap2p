"use client";

import { useActionState, useState } from "react";
import {
  createDepositIntentAction,
  claimDepositTxAction,
  type DepositIntentState,
  type ClaimTxState,
} from "./actions";

/**
 * Pooled/omnibus deposit flow (migration 0029). Enhanced with UI guardrails:
 * 1. Exchange fee confirmation checkbox.
 * 2. One-click copy buttons for exact amount and address.
 * 3. Self-service transaction hash claim lookup form.
 */
export function PooledDeposit({
  networkLabel,
  minConfirmations,
}: {
  networkLabel: string;
  minConfirmations: number;
}) {
  const [state, formAction, pending] = useActionState<
    DepositIntentState,
    FormData
  >(createDepositIntentAction, {});

  const [claimState, claimAction, claimPending] = useActionState<
    ClaimTxState,
    FormData
  >(claimDepositTxAction, {});

  const [feeConfirmed, setFeeConfirmed] = useState(false);
  const [copiedAmount, setCopiedAmount] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [showClaim, setShowClaim] = useState(false);

  const intent = state.intent;

  const copyToClipboard = (text: string, type: "amount" | "address") => {
    navigator.clipboard.writeText(text);
    if (type === "amount") {
      setCopiedAmount(true);
      setTimeout(() => setCopiedAmount(false), 2000);
    } else {
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  return (
    <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
      <h2 className="text-sm font-medium text-ink">Deposit USDT</h2>
      <p className="mt-1 text-xs text-ink-faint">
        Enter how much you want to deposit. We&apos;ll give you a shared address
        and an exact amount to send so we can match your deposit.
      </p>

      <form action={formAction} className="mt-3 space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            name="amount"
            defaultValue="100"
            inputMode="decimal"
            className="w-32 rounded-md border border-paper-border bg-paper px-3 py-1.5 font-amount text-sm text-ink focus:border-buy focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending || !feeConfirmed}
            className="rounded-md bg-ink px-4 py-1.5 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {pending ? "Generating…" : "Get deposit details"}
          </button>
        </div>

        <label className="flex items-start gap-2 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={feeConfirmed}
            onChange={(e) => setFeeConfirmed(e.target.checked)}
            className="mt-0.5 rounded border-paper-border text-ink focus:ring-buy"
          />
          <span className="text-xs text-ink-soft">
            I confirm that my exchange network withdrawal fee will <strong>NOT</strong> be deducted from the requested deposit amount.
          </span>
        </label>
      </form>

      {state.error && (
        <p role="alert" className="mt-3 text-sm text-sell">
          {state.error}
        </p>
      )}

      {intent && (
        <div className="mt-4 space-y-3 rounded-md border border-buy/40 bg-buy-wash p-4">
          <div>
            <p className="text-xs text-ink-faint">Send EXACTLY this amount</p>
            <div className="mt-1 flex items-center justify-between gap-2 rounded-md bg-paper-sunken px-3 py-2">
              <span className="font-amount text-2xl font-bold text-ink">
                {intent.exactAmount} <span className="text-sm font-normal">USDT</span>
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(intent.exactAmount, "amount")}
                className="rounded bg-paper px-2.5 py-1 text-xs font-semibold text-ink border border-paper-border hover:bg-paper-raised"
              >
                {copiedAmount ? "✓ Copied!" : "Copy amount"}
              </button>
            </div>
            <p className="mt-1 text-xs text-amber">
              The amount must match to the very last digit, or auto-crediting will fail.
            </p>
          </div>

          <div>
            <p className="text-xs text-ink-faint">To this shared address</p>
            <div className="mt-1 flex items-center justify-between gap-2 rounded-md bg-paper-sunken px-3 py-2">
              <span className="break-all font-amount text-sm text-ink select-all">
                {intent.pooledAddress}
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(intent.pooledAddress, "address")}
                className="shrink-0 rounded bg-paper px-2.5 py-1 text-xs font-semibold text-ink border border-paper-border hover:bg-paper-raised"
              >
                {copiedAddress ? "✓ Copied!" : "Copy address"}
              </button>
            </div>
          </div>

          <p className="text-xs text-ink-soft">
            Credited automatically after {minConfirmations} network confirmations. This exact request expires{" "}
            {new Date(intent.expiresAt).toLocaleString()}.
          </p>
          <p className="text-xs text-amber">
            Only send USDT on {networkLabel}. Funds sent on any other network or token are unrecoverable.
          </p>
        </div>
      )}

      {/* Self-service delayed deposit lookup tool */}
      <div className="mt-5 border-t border-paper-border pt-4">
        <button
          type="button"
          onClick={() => setShowClaim(!showClaim)}
          className="text-xs font-medium text-ink-muted hover:text-ink flex items-center gap-1"
        >
          {showClaim ? "▼ Hide deposit troubleshooting" : "▶ Deposit delayed? Verify by TxHash"}
        </button>

        {showClaim && (
          <form action={claimAction} className="mt-3 rounded-md bg-paper p-3 border border-paper-border space-y-2">
            <p className="text-xs text-ink-faint">
              If your deposit reached network confirmation but has not credited, paste your Transaction Hash (TxID) below to trigger an immediate verification:
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                name="txHash"
                placeholder="Paste TRON TxHash (TxID)…"
                className="flex-1 rounded-md border border-paper-border bg-paper-raised px-3 py-1.5 font-amount text-xs text-ink focus:border-buy focus:outline-none"
              />
              <button
                type="submit"
                disabled={claimPending}
                className="rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-paper hover:opacity-90 disabled:opacity-50"
              >
                {claimPending ? "Verifying…" : "Verify deposit"}
              </button>
            </div>

            {claimState.error && (
              <p className="text-xs text-sell mt-1">{claimState.error}</p>
            )}
            {claimState.success && (
              <p className="text-xs text-state-released font-medium mt-1">{claimState.success}</p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
