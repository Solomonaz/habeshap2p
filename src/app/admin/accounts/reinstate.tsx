"use client";

import { useActionState, useState } from "react";
import { reinstateAccountAction, type ReinstateState } from "../actions";

/**
 * Appeal control: undo a permanent ban. Money-moving and account-reactivating, so
 * it's a two-step confirm. The server action + SQL re-verify the admin and that
 * the account is actually BANNED; this is just a guard against a stray click.
 */
export function ReinstateAccount({
  userId,
  disputeId,
  forfeitedUsdt,
  compact = false,
}: {
  userId: string;
  disputeId?: string;
  /** What will be returned to the seller (their net forfeited balance). */
  forfeitedUsdt: string;
  /** Compact = inline button for the accounts list; full = labelled panel. */
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ReinstateState, FormData>(
    reinstateAccountAction,
    {},
  );
  const [confirming, setConfirming] = useState(false);

  if (state.ok) {
    return (
      <p className="rounded-md border border-state-released/40 bg-buy-wash px-3 py-2 text-sm text-state-released">
        Reinstated — {state.returned ?? forfeitedUsdt} USDT returned and the
        account can trade again.
      </p>
    );
  }

  const button = (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      {disputeId && <input type="hidden" name="disputeId" value={disputeId} />}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-buy px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Reinstating…" : `Confirm — return ${forfeitedUsdt} USDT & unban`}
      </button>
    </form>
  );

  if (compact) {
    return (
      <div className="space-y-2">
        {state.error && (
          <p role="alert" className="text-xs text-sell">
            {state.error}
          </p>
        )}
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-buy/50 px-3 py-1.5 text-xs font-semibold text-buy hover:bg-buy-wash"
          >
            Reinstate
          </button>
        ) : (
          <div className="flex items-center gap-2">
            {button}
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="rounded-md border border-paper-border px-3 py-2 text-xs text-ink-soft hover:bg-paper-sunken"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-card border border-buy/40 bg-paper-raised p-6">
      <h2 className="text-sm font-medium text-ink">Appeal — reinstate this seller</h2>
      <p className="mt-1 text-xs text-ink-faint">
        Use this if the ban was wrong — e.g. the buyer falsely marked
        &ldquo;paid&rdquo;, or the seller had a genuine reason for the delay. It
        returns the{" "}
        <span className="font-amount text-ink">{forfeitedUsdt}</span> USDT that was
        forfeited and lets them trade again.
      </p>
      <p className="mt-2 rounded-md bg-paper-sunken px-3 py-2 text-xs text-ink-faint">
        Note: this reverses the seller-side penalty only. The disputed escrow that
        was released to the buyer is not clawed back automatically (it may already
        be withdrawn).
      </p>

      {state.error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-sell"
        >
          {state.error}
        </p>
      )}

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 rounded-md bg-buy px-4 py-2.5 text-sm font-semibold text-paper hover:opacity-90"
        >
          Reinstate account
        </button>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {button}
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="rounded-md border border-paper-border px-4 py-2 text-sm text-ink-soft hover:bg-paper-sunken"
          >
            Back
          </button>
        </div>
      )}
    </div>
  );
}
