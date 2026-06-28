"use client";

import { useActionState, useState } from "react";
import {
  creditUnmatchedAction,
  ignoreUnmatchedAction,
  type UnmatchedState,
} from "./actions";

/**
 * Reconcile one unmatched pooled deposit: credit it to the suggested account in
 * one click, credit it to a manually-entered email, or ignore it. Two-step on the
 * destructive/irreversible actions; the server action + SQL re-verify the admin.
 */
export function UnmatchedReconcile({
  txHash,
  amountUsdt,
  suggested,
}: {
  txHash: string;
  amountUsdt: string;
  suggested: { userId: string; email: string | null } | null;
}) {
  const [creditState, creditAction, crediting] = useActionState<
    UnmatchedState,
    FormData
  >(creditUnmatchedAction, {});
  const [ignoreState, ignoreAction, ignoring] = useActionState<
    UnmatchedState,
    FormData
  >(ignoreUnmatchedAction, {});
  const [mode, setMode] = useState<"idle" | "manual" | "ignore">("idle");

  const error = creditState.error ?? ignoreState.error;

  return (
    <div className="mt-3 border-t border-paper-border pt-3">
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-sell"
        >
          {error}
        </p>
      )}

      {mode === "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          {suggested && (
            <form action={creditAction}>
              <input type="hidden" name="txHash" value={txHash} />
              <input type="hidden" name="userId" value={suggested.userId} />
              <button
                type="submit"
                disabled={crediting}
                className="rounded-md bg-buy px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-60"
              >
                {crediting
                  ? "Crediting…"
                  : `Credit ${amountUsdt} USDT to ${suggested.email ?? "suggested user"}`}
              </button>
            </form>
          )}
          <button
            type="button"
            onClick={() => setMode("manual")}
            className="rounded-md border border-paper-border px-4 py-2 text-sm font-medium text-ink-soft hover:bg-paper-sunken"
          >
            Credit another user
          </button>
          <button
            type="button"
            onClick={() => setMode("ignore")}
            className="rounded-md border border-sell/50 px-4 py-2 text-sm font-medium text-sell hover:bg-sell-wash"
          >
            Ignore
          </button>
        </div>
      )}

      {mode === "manual" && (
        <form action={creditAction} className="space-y-2">
          <input type="hidden" name="txHash" value={txHash} />
          <p className="text-xs text-ink-muted">
            Credit the {amountUsdt} USDT to the account that made this deposit. Only
            do this once you&apos;re sure who it belongs to.
          </p>
          <input
            type="email"
            name="email"
            placeholder="user@example.com"
            className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink focus:border-buy focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={crediting}
              className="rounded-md bg-buy px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-60"
            >
              {crediting ? "Crediting…" : `Credit ${amountUsdt} USDT`}
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              disabled={crediting}
              className="rounded-md border border-paper-border px-4 py-2 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              Back
            </button>
          </div>
        </form>
      )}

      {mode === "ignore" && (
        <form action={ignoreAction} className="space-y-2">
          <input type="hidden" name="txHash" value={txHash} />
          <p className="text-xs text-ink-muted">
            Dismiss this transfer (dust, or not a real deposit). It stays on-chain
            but leaves the reconciliation queue.
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={ignoring}
              className="rounded-md bg-sell px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-60"
            >
              {ignoring ? "Ignoring…" : "Confirm ignore"}
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              disabled={ignoring}
              className="rounded-md border border-paper-border px-4 py-2 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              Back
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
