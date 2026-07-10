"use client";

import { useActionState, useState } from "react";
import type { AdWithPoster } from "@/lib/ads";
import type { PaymentMethod } from "@/types/domain";
import {
  PAYMENT_METHOD_LABELS,
  accountNumberLabel,
  accountNumberPlaceholder,
} from "@/lib/labels";
import { formatEtb, formatRate } from "@/lib/format";
import { formatUsdt } from "@/lib/money";
import { formatTradeLimit } from "@/lib/reputation";
import { traderName } from "@/lib/handle";
import { CopyButton } from "@/components/copy-button";
import { openOrder, type OpenOrderState } from "./actions";

export function TradeForm({
  ad,
  takerLimit,
  buyerName,
}: {
  ad: AdWithPoster;
  takerLimit: number | null;
  /** The buyer's verified/registered name, pre-filled so they don't re-enter it. */
  buyerName: string;
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

  // For a SELL ad the buyer can only take up to the seller's LIVE capacity, capped
  // by their current balance (migration 0059). `fundable` is false when the seller
  // can't even cover this ad's minimum right now. BUY ads carry no capacity.
  const cap = takerIsBuyer ? ad.capacity ?? null : null;
  const sellerOutOfFunds = cap != null && !cap.fundable;
  const maxEtb = cap?.effectiveMaxEtb ?? ad.max_etb;

  const amountNum = Number(amount);
  const etb = Number.isFinite(amountNum) && amountNum > 0 ? amountNum * rate : 0;
  const minUsdt = rate > 0 ? Number(ad.min_etb) / rate : 0;
  const maxUsdt = rate > 0 ? Number(maxEtb) / rate : 0;
  // The buyer's amount can't exceed what the seller can actually deliver now.
  const overSellerMax =
    takerIsBuyer && cap != null && amountNum > 0 && amountNum > maxUsdt;

  // For a SELL ad, show the receiving account of the method the buyer picked
  // (migration 0052). Fall back to the legacy single columns for older ads.
  const chosenAccount =
    ad.receiving_accounts?.find((a) => a.method === method) ?? null;
  const recvName = chosenAccount?.name || ad.receiving_name || "";
  const recvNumber = chosenAccount?.number || ad.receiving_number || "";
  const recvNote = chosenAccount?.note || ad.receiving_note || "";

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
            {formatEtb(ad.min_etb)}–{formatEtb(maxEtb)} ETB
          </dd>
        </div>
        {cap != null && !sellerOutOfFunds && (
          <div className="flex justify-between">
            <dt className="text-ink-muted">Available now</dt>
            <dd className="font-amount text-ink-soft">
              {formatUsdt(maxUsdt.toFixed(2))} USDT
            </dd>
          </div>
        )}
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

      {sellerOutOfFunds && (
        <div className="mt-4 rounded-md border border-amber/40 bg-amber-wash px-3 py-2.5 text-sm text-ink-soft">
          This seller is temporarily out of USDT for this offer, so it can&apos;t
          be taken right now. Please check back later or choose another offer.
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
          {overSellerMax && !overLimit && (
            <span className="mt-1 block text-xs text-sell">
              Only {formatUsdt(maxUsdt.toFixed(2))} USDT is available from this
              seller right now — lower the amount.
            </span>
          )}
        </label>

        <div className="rounded-md bg-paper-sunken px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-muted">
              {takerIsBuyer ? "You pay" : "You receive"}
            </span>
            <div className="flex items-center gap-2">
              <span className="font-amount text-ink">
                {etb > 0 ? formatEtb(String(etb)) : "—"} ETB
              </span>
              {etb > 0 && (
                <CopyButton value={etb.toFixed(2)} ariaLabel="Copy amount" />
              )}
            </div>
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
                defaultValue={buyerName}
                readOnly={!!buyerName}
                placeholder="Full name on your Telebirr / bank account"
                className={
                  "mt-1 w-full rounded-md border border-paper-border px-3 py-2 text-ink placeholder:text-ink-faint focus:border-amber " +
                  (buyerName
                    ? "cursor-default bg-paper text-ink-soft"
                    : "bg-paper-sunken")
                }
              />
              <span className="mt-1 block text-xs text-ink-faint">
                {buyerName
                  ? "Your verified name. Pay from an account in this name so the seller can release."
                  : "The seller will release only if the ETB arrives from this exact name."}
              </span>
            </label>

            {/* Where the buyer sends the Birr — the seller's receiving account
                for the method the buyer picked above. */}
            {recvName && recvNumber && (
              <div className="rounded-md border border-amber/40 bg-amber-wash px-3 py-2.5 text-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-amber">
                  Send the Birr to · {PAYMENT_METHOD_LABELS[method]}
                </p>
                <div className="mt-1 flex items-center justify-between gap-2 text-ink">
                  <span>
                    <span className="text-ink-muted">Name: </span>
                    {recvName}
                  </span>
                  <CopyButton value={recvName} ariaLabel="Copy name" />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-ink">
                  <span>
                    <span className="text-ink-muted">
                      {accountNumberLabel(method)}:{" "}
                    </span>
                    <span className="font-amount">{recvNumber}</span>
                  </span>
                  <CopyButton value={recvNumber} ariaLabel="Copy number" />
                </div>
                {recvNote && (
                  <p className="mt-1 text-xs text-ink-soft">{recvNote}</p>
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
              <label className="mt-2 block">
                <span className="mb-0.5 block text-xs font-medium text-ink-soft">
                  {accountNumberLabel(method)}
                </span>
                <input
                  type="text"
                  name="receiving_number"
                  autoComplete="off"
                  placeholder={accountNumberPlaceholder(method)}
                  className="w-full rounded-md border border-paper-border bg-paper-raised px-3 py-2 font-amount text-ink placeholder:text-ink-faint focus:border-amber"
                />
              </label>
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
          disabled={pending || overLimit || overSellerMax || sellerOutOfFunds}
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
