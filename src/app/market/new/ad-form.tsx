"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AD_SIDES, PAYMENT_METHODS, type PaymentMethod } from "@/types/domain";
import {
  PAYMENT_METHOD_LABELS,
  SIDE_LABELS,
  accountNumberLabel,
  accountNumberPlaceholder,
} from "@/lib/labels";
import { formatRate, formatEtb } from "@/lib/format";
import {
  isNonNegativeDecimal,
  maxEtbForBalance,
  sellMaxExceedsBalance,
} from "@/lib/ad-capacity";
import { createAd, type CreateAdState } from "./actions";

const initialState: CreateAdState = {};

export function AdForm({
  availableUsdt,
  takenSides = [],
}: {
  availableUsdt: string;
  // Sides the user already has a live (ACTIVE/PAUSED) ad on. One open ad per
  // side (migration 0028), so a taken side cannot be posted again until the
  // existing ad is closed.
  takenSides?: string[];
}) {
  const [state, formAction, pending] = useActionState(createAd, initialState);

  // Default to a side that's still available so the form opens ready-to-post
  // rather than pre-blocked (only falls back to SELL if both are taken).
  const firstAvailable =
    AD_SIDES.find((s) => !takenSides.includes(s)) ?? "SELL";

  // Local mirror so the live preview updates as the trader types.
  const [side, setSide] = useState<(typeof AD_SIDES)[number]>(firstAvailable);

  const sideTaken = takenSides.includes(side);
  const [rate, setRate] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [notes, setNotes] = useState("");
  // SELL ads can accept several rails, each with its own receiving account.
  const [sellMethods, setSellMethods] = useState<PaymentMethod[]>([]);
  const [accounts, setAccounts] = useState<
    Record<string, { name: string; number: string; note: string }>
  >({});

  const toggleSellMethod = (m: PaymentMethod) =>
    setSellMethods((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );
  const setAccountField = (
    m: string,
    field: "name" | "number" | "note",
    v: string,
  ) =>
    setAccounts((prev) => ({
      ...prev,
      [m]: { name: "", number: "", note: "", ...prev[m], [field]: v },
    }));

  // Keep methods in the canonical PAYMENT_METHODS order for stable UI + payload.
  const orderedSellMethods = PAYMENT_METHODS.filter((m) =>
    sellMethods.includes(m),
  );
  const receivingAccountsJson = JSON.stringify(
    orderedSellMethods.map((m) => ({
      method: m,
      name: (accounts[m]?.name ?? "").trim(),
      number: (accounts[m]?.number ?? "").trim(),
      note: (accounts[m]?.note ?? "").trim(),
    })),
  );
  // Every chosen method needs a name + number before the SELL ad can post.
  const sellAccountsComplete =
    orderedSellMethods.length > 0 &&
    orderedSellMethods.every(
      (m) =>
        (accounts[m]?.name ?? "").trim() !== "" &&
        (accounts[m]?.number ?? "").trim() !== "",
    );

  const showPreview =
    rate !== "" || min !== "" || max !== "" || notes.trim() !== "";

  // SELL ads deliver USDT from escrow, so the advertised max can't exceed what
  // the seller's balance can fund at this rate. Mirror the server check live.
  const rateValid = isNonNegativeDecimal(rate) && Number(rate) > 0;
  const maxValid = isNonNegativeDecimal(max) && Number(max) > 0;
  const capEtb =
    side === "SELL" && rateValid ? maxEtbForBalance(availableUsdt, rate) : null;
  const maxExceedsBalance =
    side === "SELL" &&
    rateValid &&
    maxValid &&
    sellMaxExceedsBalance(max, availableUsdt, rate);

  return (
    <form action={formAction} className="mt-6 space-y-6">
      <fieldset>
        <legend className="text-sm font-medium text-ink">I want to</legend>
        <div
          role="radiogroup"
          aria-label="Ad side"
          className="mt-2 inline-flex rounded-md border border-paper-border bg-paper-raised p-0.5"
        >
          {AD_SIDES.map((s) => (
            <label
              key={s}
              className={
                "cursor-pointer rounded px-3 py-1.5 text-sm transition-colors " +
                (side === s
                  ? "bg-ink text-paper-raised"
                  : "text-ink-muted hover:text-ink")
              }
            >
              <input
                type="radio"
                name="side"
                value={s}
                checked={side === s}
                onChange={() => setSide(s)}
                className="sr-only"
              />
              {SIDE_LABELS[s]}
            </label>
          ))}
        </div>
      </fieldset>

      {sideTaken && (
        <p
          role="alert"
          className="rounded-md border border-amber/40 bg-amber-wash px-3 py-2 text-sm text-amber"
        >
          You already have an open {SIDE_LABELS[side]} ad — only one per side is
          allowed. Close or edit it from{" "}
          <Link href="/market/mine" className="font-medium underline">
            My ads
          </Link>{" "}
          before posting another.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Rate (ETB / USDT)"
          name="rate_etb"
          value={rate}
          onChange={setRate}
          placeholder="155.50"
        />
        <Field
          label="Min order (ETB)"
          name="min_etb"
          value={min}
          onChange={setMin}
          placeholder="1000"
        />
        <Field
          label="Max order (ETB)"
          name="max_etb"
          value={max}
          onChange={setMax}
          placeholder="50000"
          invalid={maxExceedsBalance}
        />
      </div>

      {side === "SELL" && (
        <p
          className={
            "text-xs " +
            (maxExceedsBalance ? "text-state-disputed" : "text-ink-faint")
          }
        >
          {maxExceedsBalance ? (
            <>
              Your max exceeds your balance. You hold{" "}
              <span className="font-amount">{availableUsdt}</span> USDT, which
              covers orders up to{" "}
              <span className="font-amount">{formatEtb(capEtb!)}</span> ETB at
              this rate. Lower the max or deposit more USDT.
            </>
          ) : capEtb ? (
            <>
              Selling from a balance of{" "}
              <span className="font-amount">{availableUsdt}</span> USDT — at this
              rate your max can be at most{" "}
              <span className="font-amount">{formatEtb(capEtb)}</span> ETB.
            </>
          ) : (
            <>
              You hold <span className="font-amount">{availableUsdt}</span> USDT.
              Enter a rate to see the largest order you can advertise.
            </>
          )}
        </p>
      )}

      {side === "BUY" && (
        <label className="block">
          <span className="text-sm font-medium text-ink">
            Your payment-account name
          </span>
          <p className="mt-0.5 text-xs text-ink-faint">
            Since you are buying, sellers must see the name you will pay from.
            They are instructed to refuse if it doesn&apos;t match.
          </p>
          <input
            type="text"
            name="payer_name"
            autoComplete="name"
            placeholder="Full name on your Telebirr / bank account"
            className="mt-1 w-full rounded-md border border-paper-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-faint focus:border-amber"
          />
        </label>
      )}

      {side === "SELL" ? (
        <fieldset>
          <legend className="text-sm font-medium text-ink">
            Payment methods you accept
          </legend>
          <p className="mt-0.5 text-xs text-ink-faint">
            Pick every rail you can receive the Birr on, then add the account for
            each. Only irreversible rails are allowed.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => (
              <label
                key={m}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-paper-border bg-paper-raised px-3 py-2 text-sm text-ink-soft has-[:checked]:border-amber has-[:checked]:bg-amber-wash has-[:checked]:text-amber"
              >
                <input
                  type="checkbox"
                  checked={sellMethods.includes(m)}
                  onChange={() => toggleSellMethod(m)}
                  className="sr-only"
                />
                {PAYMENT_METHOD_LABELS[m]}
              </label>
            ))}
          </div>

          {/* One receiving-account block per selected method. */}
          {orderedSellMethods.length === 0 ? (
            <p className="mt-3 text-xs text-ink-faint">
              Select at least one method to add its receiving account.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {orderedSellMethods.map((m) => (
                <div
                  key={m}
                  className="rounded-card border border-paper-border bg-paper-sunken p-4"
                >
                  <h3 className="text-sm font-medium text-ink">
                    {PAYMENT_METHOD_LABELS[m]} receiving details
                  </h3>
                  <label className="mt-3 block">
                    <span className="mb-0.5 block text-xs font-medium text-ink-soft">
                      Account holder name
                    </span>
                    <input
                      type="text"
                      value={accounts[m]?.name ?? ""}
                      onChange={(e) =>
                        setAccountField(m, "name", e.target.value)
                      }
                      autoComplete="off"
                      placeholder="Account holder full name"
                      className="w-full rounded-md border border-paper-border bg-paper-raised px-3 py-2 text-ink placeholder:text-ink-faint focus:border-amber"
                    />
                  </label>
                  <label className="mt-2 block">
                    <span className="mb-0.5 block text-xs font-medium text-ink-soft">
                      {accountNumberLabel(m)}
                    </span>
                    <input
                      type="text"
                      value={accounts[m]?.number ?? ""}
                      onChange={(e) =>
                        setAccountField(m, "number", e.target.value)
                      }
                      autoComplete="off"
                      placeholder={accountNumberPlaceholder(m)}
                      className="w-full rounded-md border border-paper-border bg-paper-raised px-3 py-2 font-amount text-ink placeholder:text-ink-faint focus:border-amber"
                    />
                  </label>
                  <input
                    type="text"
                    value={accounts[m]?.note ?? ""}
                    onChange={(e) => setAccountField(m, "note", e.target.value)}
                    autoComplete="off"
                    placeholder="Note for buyer (optional)"
                    className="mt-2 w-full rounded-md border border-paper-border bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-amber"
                  />
                </div>
              ))}
              <p className="text-xs text-ink-faint">
                Make sure each name matches the one registered on that account.
              </p>
            </div>
          )}

          {/* Serialised payload for the server action. */}
          <input
            type="hidden"
            name="receiving_accounts"
            value={receivingAccountsJson}
          />
          {orderedSellMethods.map((m) => (
            <input key={m} type="hidden" name="payment_methods" value={m} />
          ))}
        </fieldset>
      ) : (
        <fieldset>
          <legend className="text-sm font-medium text-ink">
            Accepted methods (pick any)
          </legend>
          <p className="mt-0.5 text-xs text-ink-faint">
            Only irreversible rails are allowed.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => (
              <label
                key={m}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-paper-border bg-paper-raised px-3 py-2 text-sm text-ink-soft has-[:checked]:border-amber has-[:checked]:bg-amber-wash has-[:checked]:text-amber"
              >
                <input
                  type="checkbox"
                  name="payment_methods"
                  value={m}
                  className="h-4 w-4 accent-amber"
                />
                {PAYMENT_METHOD_LABELS[m]}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {/* General notes only on BUY ads — on a SELL ad the receiving-details
          "Note for buyer" already covers instructions, so a second notes box is
          redundant. */}
      {side === "BUY" && (
        <label className="block">
          <span className="text-sm font-medium text-ink">Notes (optional)</span>
          <p className="mt-0.5 text-xs text-ink-faint">
            Shown to anyone who opens your ad — e.g. the hours you&apos;re
            online, how fast you pay, or any special instructions.
          </p>
          <textarea
            name="notes"
            rows={3}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Online 9am–9pm. Please pay within 10 minutes. No third-party payments."
            className="mt-1 w-full resize-y rounded-md border border-paper-border bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-amber"
          />
          <span className="mt-1 block text-right text-xs text-ink-faint">
            {notes.length}/500
          </span>
        </label>
      )}

      {showPreview && (
        <div className="rounded-card border border-paper-border bg-paper-sunken p-4">
          <p className="text-xs uppercase tracking-wide text-ink-faint">
            Preview
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            You are {side === "SELL" ? "selling" : "buying"} USDT at{" "}
            <span className="font-amount text-ink">
              {rate ? formatRate(rate) : "—"}
            </span>{" "}
            ETB, for orders of{" "}
            <span className="font-amount text-ink">
              {min ? formatEtb(min) : "—"}
            </span>
            –
            <span className="font-amount text-ink">
              {max ? formatEtb(max) : "—"}
            </span>{" "}
            ETB.
          </p>
          {notes.trim() !== "" && (
            <p className="mt-2 whitespace-pre-wrap border-t border-paper-border pt-2 text-sm text-ink-soft">
              {notes.trim()}
            </p>
          )}
        </div>
      )}

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-state-disputed/30 bg-state-disputed/10 px-3 py-2 text-sm text-state-disputed"
        >
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={
            pending ||
            maxExceedsBalance ||
            sideTaken ||
            (side === "SELL" && !sellAccountsComplete)
          }
          className="rounded-md bg-amber px-5 py-2.5 text-sm font-medium text-paper-raised hover:bg-amber-soft disabled:opacity-60"
        >
          {pending ? "Posting…" : "Post ad"}
        </button>
        <Link
          href="/market"
          className="text-sm text-ink-muted hover:text-ink"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  placeholder,
  invalid = false,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  invalid?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={invalid}
        className={
          "mt-1 w-full rounded-md border bg-paper-raised px-3 py-2 font-amount text-ink placeholder:text-ink-faint " +
          (invalid
            ? "border-state-disputed focus:border-state-disputed"
            : "border-paper-border focus:border-amber")
        }
      />
    </label>
  );
}
