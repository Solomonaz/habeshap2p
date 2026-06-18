"use client";

import { useActionState, useState } from "react";
import type { DisputeResolution } from "@/types/domain";
import { resolveDisputeAction, type ResolveState } from "../../actions";

/**
 * Irreversible money-moving controls, so each side is a two-step confirm: pick a
 * ruling, then confirm it. The server action + SQL re-verify the admin; this is
 * purely a guard against a fat-fingered click.
 */
export function AdminResolve({
  disputeId,
  buyerLabel,
  sellerLabel,
  amountUsdt,
}: {
  disputeId: string;
  buyerLabel: string;
  sellerLabel: string;
  amountUsdt: string;
}) {
  const [state, formAction, pending] = useActionState<ResolveState, FormData>(
    resolveDisputeAction,
    {},
  );
  const [choice, setChoice] = useState<DisputeResolution | null>(null);

  return (
    <div className="rounded-card border border-state-disputed/40 bg-paper-raised p-6">
      <h2 className="text-sm font-medium text-ink">Rule on this dispute</h2>
      <p className="mt-1 text-xs text-ink-faint">
        This moves {amountUsdt} USDT and cannot be undone.
      </p>

      {state.error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-sell"
        >
          {state.error}
        </p>
      )}

      {!choice ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setChoice("FAVOUR_BUYER")}
            className="rounded-md bg-buy px-4 py-2.5 text-sm font-semibold text-paper hover:opacity-90"
          >
            Release to buyer
          </button>
          <button
            type="button"
            onClick={() => setChoice("FAVOUR_SELLER")}
            className="rounded-md bg-sell px-4 py-2.5 text-sm font-semibold text-paper hover:opacity-90"
          >
            Return to seller
          </button>
        </div>
      ) : (
        <form action={formAction} className="mt-4 space-y-3">
          <input type="hidden" name="disputeId" value={disputeId} />
          <input type="hidden" name="resolution" value={choice} />
          <p className="rounded-md bg-paper-sunken px-3 py-2.5 text-sm text-ink-soft">
            {choice === "FAVOUR_BUYER" ? (
              <>
                Release <span className="font-amount text-ink">{amountUsdt}</span>{" "}
                USDT to <span className="font-medium text-ink">{buyerLabel}</span>{" "}
                (the buyer). The order becomes RELEASED.
              </>
            ) : (
              <>
                Return <span className="font-amount text-ink">{amountUsdt}</span>{" "}
                USDT to{" "}
                <span className="font-medium text-ink">{sellerLabel}</span> (the
                seller). The order becomes CANCELLED.
              </>
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className={
                "rounded-md px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-60 " +
                (choice === "FAVOUR_BUYER" ? "bg-buy" : "bg-sell")
              }
            >
              {pending ? "Resolving…" : "Confirm ruling"}
            </button>
            <button
              type="button"
              onClick={() => setChoice(null)}
              disabled={pending}
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
