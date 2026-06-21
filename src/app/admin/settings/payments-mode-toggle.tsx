"use client";

import { useActionState } from "react";
import {
  setPaymentsModeAction,
  type PaymentsModeState,
} from "../actions";

/**
 * The admin's TEST ↔ LIVE payments switch. In TEST mode users get the dev faucet
 * and the no-network stub chain; flipping to LIVE replaces the faucet with real
 * on-chain Tron deposits/withdrawals. Enabling LIVE is refused server-side
 * unless the Tron secrets are configured, so `configured` here just lets us warn
 * up front and disable the button.
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

      <form action={formAction} className="mt-4">
        <input type="hidden" name="enabled" value={next} />
        <button
          type="submit"
          disabled={pending || (!live && !configured)}
          className={
            "rounded-md px-4 py-2 text-sm font-semibold text-paper disabled:opacity-50 " +
            (live
              ? "bg-amber hover:bg-amber-soft"
              : "bg-sell hover:opacity-90")
          }
        >
          {pending
            ? "Saving…"
            : live
              ? "Switch to test mode"
              : "Enable live payments"}
        </button>
      </form>
    </section>
  );
}
