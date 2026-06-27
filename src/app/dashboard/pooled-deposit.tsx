"use client";

import { useActionState } from "react";
import {
  createDepositIntentAction,
  type DepositIntentState,
} from "./actions";

/**
 * Pooled/omnibus deposit flow (migration 0029). In pooled mode there is no
 * per-user deposit address — everyone sends to one shared address — so the user
 * first requests an intent: they enter the amount they intend to deposit and get
 * back the shared address plus a UNIQUE exact amount to send. The poller matches
 * the inbound transfer to this user by that exact amount.
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

  const intent = state.intent;

  return (
    <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
      <h2 className="text-sm font-medium text-ink">Deposit USDT</h2>
      <p className="mt-1 text-xs text-ink-faint">
        Enter how much you want to deposit. We&apos;ll give you a shared address
        and an exact amount to send so we can match your deposit.
      </p>

      <form action={formAction} className="mt-3 flex items-center gap-2">
        <input
          type="text"
          name="amount"
          defaultValue="100"
          inputMode="decimal"
          className="w-32 rounded-md border border-paper-border bg-paper px-3 py-1.5 font-amount text-sm text-ink focus:border-buy focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-1.5 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Generating…" : "Get deposit details"}
        </button>
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
            <p className="mt-0.5 font-amount text-2xl text-ink">
              {intent.exactAmount} <span className="text-sm">USDT</span>
            </p>
            <p className="text-xs text-amber">
              The amount must match to the last digit, or we can&apos;t credit it.
            </p>
          </div>
          <div>
            <p className="text-xs text-ink-faint">To this address</p>
            <p className="mt-0.5 break-all rounded-md bg-paper-sunken px-3 py-2 font-amount text-sm text-ink">
              {intent.pooledAddress}
            </p>
          </div>
          <p className="text-xs text-ink-soft">
            Credited after {minConfirmations} confirmations. This request expires{" "}
            {new Date(intent.expiresAt).toLocaleString()}.
          </p>
          <p className="text-xs text-amber">
            Only send USDT on {networkLabel}. Funds sent on any other network or
            token are unrecoverable.
          </p>
        </div>
      )}
    </section>
  );
}
