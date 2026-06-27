"use client";

import { useActionState, useState } from "react";
import {
  setSweepStrategyAction,
  type SweepStrategyState,
} from "../actions";
import type { SweepStrategy } from "@/lib/settings";

/**
 * The admin's deposit-gas strategy switch (migration 0029). Replaces the old
 * model that sent (and burned) TRX on every sweep. The three strategies:
 *   staking — delegate Energy from the hot wallet's frozen TRX (no burn).
 *   rental  — rent Energy from an external market for each sweep.
 *   pooled  — one shared deposit address, no per-user sweep at all.
 */
const OPTIONS: {
  value: SweepStrategy;
  title: string;
  blurb: string;
}[] = [
  {
    value: "staking",
    title: "Staking — delegate Energy",
    blurb:
      "Freeze TRX in the hot wallet for Energy and lend it to each deposit address just long enough to sweep. TRX is locked, never burned. Stake TRX below.",
  },
  {
    value: "rental",
    title: "Rental — rent Energy",
    blurb:
      "Rent Energy from an external market for each sweep. No TRX locked; a small recurring fee per deposit. Needs ENERGY_RENTAL_API_URL / _KEY configured.",
  },
  {
    value: "pooled",
    title: "Pooled — one shared address",
    blurb:
      "Everyone deposits to a single shared address (the hot wallet). No per-user sweep, so zero gas cost. Deposits are matched by a unique exact amount.",
  },
];

export function SweepStrategyForm({
  current,
  pooledAddress,
}: {
  current: SweepStrategy;
  pooledAddress: string | null;
}) {
  const [state, formAction, pending] = useActionState<
    SweepStrategyState,
    FormData
  >(setSweepStrategyAction, {});
  const [selected, setSelected] = useState<SweepStrategy>(current);

  return (
    <section className="mt-6 rounded-card border border-paper-border bg-paper-raised p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-ink">Deposit gas strategy</h2>
          <p className="mt-1 text-xs text-ink-faint">
            How received deposits are consolidated without burning TRX.
          </p>
        </div>
        <span className="rounded bg-paper-sunken px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
          {current}
        </span>
      </div>

      <form action={formAction} className="mt-4 space-y-3">
        {OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={
              "flex cursor-pointer gap-3 rounded-md border p-3 " +
              (selected === opt.value
                ? "border-buy/50 bg-buy-wash"
                : "border-paper-border bg-paper")
            }
          >
            <input
              type="radio"
              name="strategy"
              value={opt.value}
              checked={selected === opt.value}
              onChange={() => setSelected(opt.value)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-ink">
                {opt.title}
              </span>
              <span className="mt-0.5 block text-xs text-ink-soft">
                {opt.blurb}
              </span>
            </span>
          </label>
        ))}

        {selected === "pooled" && (
          <div className="rounded-md border border-paper-border bg-paper p-3">
            <label className="block text-xs font-medium text-ink-soft">
              Pooled deposit address (optional)
            </label>
            <input
              type="text"
              name="pooledAddress"
              defaultValue={pooledAddress ?? ""}
              placeholder="Leave blank to use the hot-wallet address"
              className="mt-1 w-full break-all rounded-md border border-paper-border bg-paper-sunken px-3 py-2 font-amount text-xs text-ink focus:border-buy focus:outline-none"
            />
            <p className="mt-1 text-xs text-ink-faint">
              Where all users send deposits. Blank = the configured hot wallet.
            </p>
          </div>
        )}

        {state.error && (
          <p
            role="alert"
            className="rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-sell"
          >
            {state.error}
          </p>
        )}
        {state.ok && (
          <p
            role="status"
            className="rounded-md border border-buy/40 bg-buy-wash px-3 py-2 text-sm text-buy"
          >
            Sweep strategy updated.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save strategy"}
        </button>
      </form>
    </section>
  );
}
