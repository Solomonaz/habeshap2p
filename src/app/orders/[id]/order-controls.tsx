"use client";

import { useActionState, useEffect, useState } from "react";
import type { OrderState } from "@/types/domain";
import { runOrderAction, type OrderActionState } from "./actions";

function useCountdown(expiresAt: string, active: boolean) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, new Date(expiresAt).getTime() - Date.now()),
  );
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, active]);
  return remaining;
}

export function OrderControls({
  orderId,
  state,
  isBuyer,
  isSeller,
  expiresAt,
  amountEtb,
  buyerPaymentName,
  dispute,
}: {
  orderId: string;
  state: OrderState;
  isBuyer: boolean;
  isSeller: boolean;
  expiresAt: string;
  amountEtb: string;
  buyerPaymentName: string;
  dispute: { reason: string; openedByMe: boolean } | null;
}) {
  const [actionState, formAction, pending] = useActionState<
    OrderActionState,
    FormData
  >(runOrderAction, {});
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [showDispute, setShowDispute] = useState(false);

  const remaining = useCountdown(expiresAt, state === "CREATED");
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const expired = remaining <= 0;

  if (state === "RELEASED") {
    return (
      <p className="rounded-md border border-state-released/40 bg-buy-wash px-4 py-3 text-sm text-state-released">
        Released. The buyer received their USDT and the trade is complete.
      </p>
    );
  }
  if (state === "CANCELLED") {
    return (
      <p className="rounded-md border border-paper-border bg-paper-sunken px-4 py-3 text-sm text-ink-muted">
        This order was cancelled.
      </p>
    );
  }
  if (state === "DISPUTED") {
    return (
      <div className="rounded-md border border-state-disputed/40 bg-sell-wash px-4 py-3 text-sm text-state-disputed">
        <p className="font-medium">
          Order is in dispute — escrow is frozen until an admin rules.
        </p>
        {dispute && (
          <p className="mt-2 text-state-disputed/90">
            <span className="text-state-disputed/70">
              {dispute.openedByMe ? "Your reason: " : "Reason given: "}
            </span>
            {dispute.reason}
          </p>
        )}
        <p className="mt-2 text-xs text-state-disputed/70">
          An admin will review the chat and payment proof and decide whether the
          USDT is released to the buyer or returned to the seller.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {state === "CREATED" && (
        <div className="flex items-center justify-between rounded-md bg-paper-sunken px-4 py-3 text-sm">
          <span className="text-ink-muted">
            {expired ? "Payment window elapsed" : "Time to pay"}
          </span>
          <span className="font-amount text-ink">
            {expired
              ? "auto-cancelling…"
              : `${mins}:${secs.toString().padStart(2, "0")}`}
          </span>
        </div>
      )}

      {actionState.error && (
        <p
          role="alert"
          className="rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-sell"
        >
          {actionState.error}
        </p>
      )}

      {/* Buyer: confirm ETB sent (CREATED only). Never releases escrow. */}
      {isBuyer && state === "CREATED" && (
        <form action={formAction}>
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="intent" value="paid" />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-amber px-4 py-2.5 text-sm font-semibold text-paper hover:bg-amber-soft disabled:opacity-60"
          >
            I&apos;ve paid {amountEtb} ETB
          </button>
        </form>
      )}

      {/* Seller: the critical, explicit release. Gated by a confirmation. */}
      {isSeller && (state === "CREATED" || state === "PAID") && (
        <div className="rounded-md border border-paper-border bg-paper-sunken p-4">
          <p className="text-sm text-ink-soft">
            Only release after you have confirmed{" "}
            <span className="font-medium text-ink">{amountEtb} ETB</span>{" "}
            landed in your account from{" "}
            <span className="font-medium text-ink">{buyerPaymentName}</span>.
          </p>
          <label className="mt-3 flex items-start gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={confirmRelease}
              onChange={(e) => setConfirmRelease(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-buy"
            />
            I confirm the payer name matches and the funds have cleared.
          </label>
          <form action={formAction} className="mt-3">
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="intent" value="release" />
            <button
              type="submit"
              disabled={pending || !confirmRelease}
              className="w-full rounded-md bg-buy px-4 py-2.5 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-40"
            >
              Release USDT to buyer
            </button>
          </form>
        </div>
      )}

      {/* Either party may cancel while still unpaid. */}
      {(isBuyer || isSeller) && state === "CREATED" && (
        <form action={formAction}>
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="intent" value="cancel" />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md border border-paper-border px-4 py-2 text-sm text-ink-soft hover:bg-paper-sunken disabled:opacity-60"
          >
            Cancel order
          </button>
        </form>
      )}

      {/* Once PAID, neither side can act unilaterally — the only escape from a
          stuck trade (buyer paid but seller won't release, or seller says the
          ETB never arrived / wrong name) is to escalate to an admin. */}
      {(isBuyer || isSeller) && state === "PAID" && (
        <div className="rounded-md border border-paper-border bg-paper-sunken p-4">
          {!showDispute ? (
            <button
              type="button"
              onClick={() => setShowDispute(true)}
              className="text-sm text-state-disputed hover:underline"
            >
              Something wrong? Open a dispute
            </button>
          ) : (
            <form action={formAction} className="space-y-3">
              <input type="hidden" name="orderId" value={orderId} />
              <input type="hidden" name="intent" value="dispute" />
              <p className="text-sm text-ink-soft">
                {isBuyer
                  ? "Paid but the seller won't release? Explain what happened — an admin will review the chat and your payment proof."
                  : "Funds not received, or the payer name doesn't match? Explain what happened — an admin will review the chat and any proof."}
              </p>
              <textarea
                name="reason"
                required
                rows={3}
                maxLength={1000}
                placeholder="Describe the problem in detail…"
                className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-state-disputed focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-state-disputed px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-60"
                >
                  Submit dispute
                </button>
                <button
                  type="button"
                  onClick={() => setShowDispute(false)}
                  className="rounded-md border border-paper-border px-4 py-2 text-sm text-ink-soft hover:bg-paper"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-ink-faint">
                Opening a dispute freezes the escrow until an admin decides. Only
                do this if you can&apos;t resolve it in chat.
              </p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
