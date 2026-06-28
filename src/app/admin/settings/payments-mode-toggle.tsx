"use client";

import { useActionState, useState } from "react";
import {
  setPaymentsModeAction,
  type PaymentsModeState,
} from "../actions";

/**
 * The admin's TEST ↔ LIVE payments switch. Enhanced with a double-confirmation guardrail
 * so admins never accidentally flip real money modes.
 */
export function PaymentsModeToggle({
  live,
  configured,
}: {
  live: boolean;
  configured: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    PaymentsModeState,
    FormData
  >(setPaymentsModeAction, {});

  const [showConfirm, setShowConfirm] = useState(false);

  // The form flips to the opposite of the current mode.
  const next = live ? "false" : "true";

  return (
    <section className="mt-6 rounded-card border border-paper-border bg-paper-raised p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-ink">Payments mode</h2>
          <p className="mt-1 text-xs text-ink-faint">
            Controls whether the platform moves real money.
          </p>
        </div>
        <span
          className={
            "rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide " +
            (live ? "bg-sell-wash text-sell" : "bg-amber-wash text-amber")
          }
        >
          {live ? "Live — real money" : "Test — dev faucet"}
        </span>
      </div>

      <div className="mt-4 space-y-2 text-sm text-ink-soft">
        {live ? (
          <p>
            The platform is <strong className="text-ink">LIVE</strong>. The dev
            faucet is disabled and deposits/withdrawals settle on-chain through
            the configured Tron provider. Switch back to test mode to mint test
            USDT again.
          </p>
        ) : (
          <p>
            The platform is in <strong className="text-ink">test</strong> mode.
            The dev faucet mints test USDT and nothing touches the chain. Turn on
            live payments to start moving real money — this replaces the faucet
            with the real Tron deposit and withdrawal flows.
          </p>
        )}
      </div>

      {!configured && !live && (
        <p className="mt-3 rounded-md border border-amber/40 bg-amber-wash px-3 py-2 text-xs text-amber">
          The Tron provider isn&apos;t configured yet. Set TRON_API_KEY,
          TRON_HOT_WALLET_ADDRESS, TRON_HOT_WALLET_PRIVATE_KEY and
          TRON_DEPOSIT_MNEMONIC on the server before enabling live payments.
        </p>
      )}

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
          Payments mode updated.
        </p>
      )}

      {!showConfirm ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            disabled={pending || (!live && !configured)}
            className={
              "rounded-md px-4 py-2 text-sm font-semibold text-paper disabled:opacity-50 " +
              (live
                ? "bg-amber hover:bg-amber-soft"
                : "bg-sell hover:opacity-90")
            }
          >
            {live ? "Switch to test mode" : "Enable live payments"}
          </button>
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-amber/40 bg-amber-wash p-4 space-y-3">
          <p className="text-xs font-semibold text-amber">
            ⚠️ CONFIRM MODE CHANGE: Are you sure you want to switch from{" "}
            <span className="underline">{live ? "LIVE" : "TEST"}</span> to{" "}
            <span className="underline">{live ? "TEST" : "LIVE"}</span> mode?
          </p>
          <form action={formAction} className="flex items-center gap-2">
            <input type="hidden" name="enabled" value={next} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-ink px-3.5 py-1.5 text-xs font-semibold text-paper hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Yes, confirm mode change"}
            </button>
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              className="rounded-md border border-paper-border bg-paper px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper-raised"
            >
              Cancel
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
