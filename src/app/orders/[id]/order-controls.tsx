"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { OrderState } from "@/types/domain";
import {
  runOrderAction,
  expireOrderAction,
  freezeSellerAction,
  type OrderActionState,
} from "./actions";

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
  const router = useRouter();
  const [actionState, formAction, pending] = useActionState<
    OrderActionState,
    FormData
  >(runOrderAction, {});
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [expiring, setExpiring] = useState(false);
  const [freezing, setFreezing] = useState(false);

  // The window keeps counting through CREATED *and* PAID, but only an UNPAID
  // (CREATED) order auto-cancels when it elapses — a PAID order freezes for
  // dispute instead (auto-cancelling it could strand the buyer's ETB).
  const remaining = useCountdown(
    expiresAt,
    state === "CREATED" || state === "PAID",
  );
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const expired = remaining <= 0;

  // Bug #1: the instant the countdown hits zero on an unpaid order, cancel it
  // server-side and refresh — don't sit on "auto-cancelling…" waiting for the
  // cron. The SQL re-checks the deadline, so this is a no-op if not truly due.
  useEffect(() => {
    if (state !== "CREATED" || !expired || expiring) return;
    setExpiring(true);
    void expireOrderAction(orderId).finally(() => router.refresh());
  }, [state, expired, expiring, orderId, router]);

  // The mirror for a PAID order: the instant the release window elapses, the
  // seller has missed their chance. Freeze their whole wallet, temp-ban them,
  // and auto-open a dispute server-side, then refresh — the page re-renders into
  // the DISPUTED branch. The SQL re-checks the PAID state + deadline, so this is
  // a no-op if the order was meanwhile released or isn't truly due.
  useEffect(() => {
    if (state !== "PAID" || !expired || freezing) return;
    setFreezing(true);
    void freezeSellerAction(orderId).finally(() => router.refresh());
  }, [state, expired, freezing, orderId, router]);

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
      {(state === "CREATED" || state === "PAID") && (
        <div className="flex items-center justify-between rounded-md bg-paper-sunken px-4 py-3 text-sm">
          <span className="text-ink-muted">
            {expired
              ? "Payment window elapsed"
              : state === "PAID"
                ? "Awaiting seller release"
                : "Time to pay"}
          </span>
          <span className="font-amount text-ink">
            {expired
              ? state === "CREATED"
                ? "auto-cancelling…"
                : "freezing escrow…"
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

      {/* Buyer: confirm ETB sent (CREATED, before the window elapses). Never
          releases escrow. Once expired the order is auto-cancelling, so the
          button is withdrawn (the DB would reject it anyway). */}
      {isBuyer && state === "CREATED" && !expired && (
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

      {/* Seller: the critical, explicit release. Gated by a confirmation. The
          seller may ONLY release before the window elapses — for both unpaid and
          paid orders. Once the clock runs out the escrow is frozen (SQL enforces
          it): an unpaid order is cancel-only, a paid one is dispute-only. */}
      {isSeller && (state === "CREATED" || state === "PAID") && !expired && (
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

      {/* Either party may cancel while still unpaid and within the window. Once
          the window elapses the order auto-cancels, so the manual button is
          withdrawn to avoid a redundant click racing the auto-cancel. */}
      {(isBuyer || isSeller) && state === "CREATED" && !expired && (
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

      {/* The instant a PAID order's release window elapses, the seller has missed
          their chance. The client effect above fires the auto-freeze (seller's
          whole wallet frozen + temp-banned + dispute opened) and refreshes into
          the DISPUTED branch. This banner shows for the brief moment in between. */}
      {(isBuyer || isSeller) && state === "PAID" && expired && (
        <div className="rounded-md border border-state-disputed/40 bg-sell-wash px-4 py-3 text-sm text-state-disputed">
          <p className="font-medium">
            Release window elapsed — freezing the seller&apos;s escrow.
          </p>
          <p className="mt-1 text-state-disputed/90">
            The seller did not release in time. Their funds are being frozen and
            the order escalated to an admin dispute automatically — no action is
            needed. {isSeller && "Your account is temporarily suspended pending review."}
          </p>
        </div>
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
