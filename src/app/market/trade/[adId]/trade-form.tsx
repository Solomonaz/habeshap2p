"use client";

import { useActionState, useState } from "react";
import type { AdWithPoster } from "@/lib/ads";
import type { PaymentMethod } from "@/types/domain";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { formatEtb, formatRate } from "@/lib/format";
import { formatTradeLimit } from "@/lib/reputation";
import { traderName } from "@/lib/handle";
import { openOrder, type OpenOrderState } from "./actions";

export function TradeForm({
  ad,
  takerLimit,
}: {
  ad: AdWithPoster;
  takerLimit: number | null;
}) {
  const [state, formAction, pending] = useActionState<OpenOrderState, FormData>(
    openOrder,
    {},
  );

  // Taker is the BUYER when the advertiser is SELLing USDT.
  const takerIsBuyer = ad.side === "SELL";
  const rate = Number(ad.rate_etb);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(
    ad.payment_methods[0] ?? "TELEBIRR",
  );

  const amountNum = Number(amount);
  const etb = Number.isFinite(amountNum) && amountNum > 0 ? amountNum * rate : 0;
  const minUsdt = rate > 0 ? Number(ad.min_etb) / rate : 0;
  const maxUsdt = rate > 0 ? Number(ad.max_etb) / rate : 0;

  // Soft client-side hint; the SQL (order_create) is the authoritative guard.
  const overLimit =
    takerLimit !== null && amountNum > 0 && amountNum > takerLimit;

  const action = takerIsBuyer ? "Buy" : "Sell";
  const actionColor = takerIsBuyer
    ? "bg-buy text-paper hover:opacity-90"
    : "bg-sell text-paper hover:opacity-90";

  return (
    <div className="mt-6 rounded-card border border-paper-border bg-paper-raised p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">
          {action} USDT
        </h1>
        <span
          className={
            "rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide " +
            (takerIsBuyer ? "bg-buy-wash text-buy" : "bg-sell-wash text-sell")
          }
        >
          {action}
        </span>
      </div>

      <dl className="mt-4 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-muted">Price</dt>
          <dd className="font-amount text-ink">
            {formatRate(ad.rate_etb)} ETB / USDT
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-muted">Limits</dt>
          <dd className="font-amount text-ink-soft">
            {formatEtb(ad.min_etb)}–{formatEtb(ad.max_etb)} ETB
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-muted">Counterparty</dt>
          <dd className="flex items-center gap-1.5 text-ink-soft">
            <span className="text-ink">
              {traderName(ad.poster?.full_name, ad.user_id)}
            </span>
            {ad.poster?.is_verified && (
              <span
                className="inline-flex shrink-0 items-center text-buy"
                title="Identity verified"
                aria-label="Identity verified"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 2l2.4 1.8 3 .1 1 2.8 2.4 1.7-.9 2.9.9 2.9-2.4 1.7-1 2.8-3 .1L12 22l-2.4-1.8-3-.1-1-2.8L3.2 15l.9-2.9-.9-2.9 2.4-1.7 1-2.8 3-.1L12 2z" />
                  <path d="M9 12l2 2 4-4" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-muted">Track record</dt>
          <dd className="text-ink-soft">
            {ad.poster
              ? `${ad.poster.completed_trades} trades · ${ad.poster.completion_rate}%`
              : "New trader"}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-muted">Your trade limit</dt>
          <dd className="font-amount text-ink-soft">
            {formatTradeLimit(takerLimit)}
          </dd>
        </div>
      </dl>

      {ad.notes && ad.notes.trim() !== "" && (
        <div className="mt-4 rounded-md border border-paper-border bg-paper-sunken px-3 py-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            Advertiser&apos;s notes
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">
            {ad.notes}
          </p>
        </div>
      )}

      <form action={formAction} className="mt-6 space-y-4">
        <input type="hidden" name="adId" value={ad.id} />

        <label className="block">
          <span className="text-sm font-medium text-ink">Amount (USDT)</span>
          <input
            type="text"
            inputMode="decimal"
            name="amount_usdt"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.000000"
            autoComplete="off"
            className="mt-1 w-full rounded-md border border-paper-border bg-paper-sunken px-3 py-2 font-amount text-lg text-ink placeholder:text-ink-faint focus:border-amber"
          />
          <span className="mt-1 block text-xs text-ink-faint">
            ≈ {minUsdt.toFixed(2)}–{maxUsdt.toFixed(2)} USDT for this ad&apos;s
            limits
          </span>
          {overLimit && (
            <span className="mt-1 block text-xs text-sell">
              Exceeds your {formatTradeLimit(takerLimit)} per-order limit. Post a
              merchant bond on your account to lift it.
            </span>
          )}
        </label>

        <div className="rounded-md bg-paper-sunken px-3 py-2 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">
              {takerIsBuyer ? "You pay" : "You receive"}
            </span>
            <span className="font-amount text-ink">
              {etb > 0 ? formatEtb(String(etb)) : "—"} ETB
            </span>
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-ink">Payment method</span>
          <select
            name="payment_method"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            className="mt-1 w-full rounded-md border border-paper-border bg-paper-sunken px-3 py-2 text-ink focus:border-amber"
          >
            {ad.payment_methods.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </label>

        {takerIsBuyer ? (
          <>
            <label className="block">
              <span className="text-sm font-medium text-ink">
                Your payment-account name
              </span>
              <input
                type="text"
                name="buyer_payment_name"
                autoComplete="name"
                placeholder="Full name on your Telebirr / bank account"
                className="mt-1 w-full rounded-md border border-paper-border bg-paper-sunken px-3 py-2 text-ink placeholder:text-ink-faint focus:border-amber"
              />
              <span className="mt-1 block text-xs text-ink-faint">
                The seller will release only if the ETB arrives from this exact
                name.
              </span>
            </label>

            {/* Where the buyer sends the Birr — the seller's receiving account. */}
            {ad.receiving_name && ad.receiving_number && (
              <div className="rounded-md border border-amber/40 bg-amber-wash px-3 py-2.5 text-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-amber">
                  Send the Birr to
                </p>
                <p className="mt-1 text-ink">
                  <span className="text-ink-muted">Name: </span>
                  {ad.receiving_name}
                </p>
                <p className="text-ink">
                  <span className="text-ink-muted">
                    {PAYMENT_METHOD_LABELS[method]}:{" "}
                  </span>
                  <span className="font-amount">{ad.receiving_number}</span>
                </p>
                {ad.receiving_note && (
                  <p className="mt-1 text-xs text-ink-soft">
                    {ad.receiving_note}
                  </p>
                )}
                <p className="mt-1.5 text-xs text-ink-faint">
                  You&apos;ll confirm these details again once the order opens.
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="rounded-md border border-paper-border bg-paper-sunken px-3 py-2 text-sm">
              <span className="text-ink-muted">You receive ETB from</span>{" "}
              <span className="text-ink">{ad.payer_name ?? "—"}</span>
              <p className="mt-1 text-xs text-ink-faint">
                Refuse to release if the payment comes from a different name.
              </p>
            </div>

            {/* The seller (taker) tells the buyer where to send the Birr. */}
            <div className="rounded-md border border-paper-border bg-paper-sunken p-3">
              <p className="text-sm font-medium text-ink">
                Where should the buyer pay you?
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">
                Your {PAYMENT_METHOD_LABELS[method]} account — shown to the buyer
                so they know where to send the Birr.
              </p>
              <input
                type="text"
                name="receiving_name"
                autoComplete="off"
                placeholder="Account holder full name"
                className="mt-2 w-full rounded-md border border-paper-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-faint focus:border-amber"
              />
              <input
                type="text"
                name="receiving_number"
                autoComplete="off"
                placeholder="Account number / phone (e.g. 09xxxxxxxx)"
                className="mt-2 w-full rounded-md border border-paper-border bg-paper-raised px-3 py-2 font-amount text-ink placeholder:text-ink-faint focus:border-amber"
              />
              <input
                type="text"
                name="receiving_note"
                autoComplete="off"
                placeholder="Note for buyer (optional)"
                className="mt-2 w-full rounded-md border border-paper-border bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-amber"
              />
            </div>
          </>
        )}

        {state.error && (
          <p
            role="alert"
            className="rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-sell"
          >
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending || overLimit}
          className={
            "w-full rounded-md px-4 py-2.5 text-sm font-semibold disabled:opacity-60 " +
            actionColor
          }
        >
          {pending ? "Opening…" : `${action} USDT`}
        </button>
        <p className="text-center text-xs text-ink-faint">
          Opening locks the seller&apos;s USDT in escrow until release.
        </p>
      </form>
    </div>
  );
}
