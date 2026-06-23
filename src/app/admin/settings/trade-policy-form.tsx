"use client";

import { useActionState } from "react";
import type { TradePolicy } from "@/lib/reputation";
import { setTradePolicyAction, type TradePolicyState } from "../actions";

/**
 * Admin control for the per-order trade limits and the merchant-bond minimum
 * (migration 0021). Each cap is the largest single order a user in that tier may
 * open; leaving a cap blank makes that tier unlimited. Merchants (users who post
 * the bond) are always unlimited. These values are the authoritative gate —
 * order_create enforces them in SQL.
 */
export function TradePolicyForm({ policy }: { policy: TradePolicy }) {
  const [state, formAction, pending] = useActionState<
    TradePolicyState,
    FormData
  >(setTradePolicyAction, {});

  const capValue = (c: number | null) => (c === null ? "" : String(c));

  return (
    <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
      <div>
        <h2 className="text-sm font-medium text-ink">Trade limits &amp; bond</h2>
        <p className="mt-1 text-xs text-ink-faint">
          Per-order caps by trader tier, and the collateral a user must lock to
          become an uncapped merchant. Leave a cap blank for unlimited.
        </p>
      </div>

      <form action={formAction} className="mt-4 space-y-5">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Per-order limits (USDT)
          </h3>
          <div className="mt-2 grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs font-medium text-ink-soft">
                New trader
              </span>
              <input
                name="newCap"
                type="text"
                inputMode="decimal"
                defaultValue={capValue(policy.newCap)}
                placeholder="unlimited"
                className="mt-1 w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-ink-soft">
                Active trader
              </span>
              <input
                name="activeCap"
                type="text"
                inputMode="decimal"
                defaultValue={capValue(policy.activeCap)}
                placeholder="unlimited"
                className="mt-1 w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-ink-soft">
                Established trader
              </span>
              <input
                name="establishedCap"
                type="text"
                inputMode="decimal"
                defaultValue={capValue(policy.establishedCap)}
                placeholder="unlimited"
                className="mt-1 w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink"
              />
            </label>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Tier thresholds (completed trades)
          </h3>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-ink-soft">
                Active after
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  name="activeAfter"
                  type="text"
                  inputMode="numeric"
                  defaultValue={String(policy.activeAfter)}
                  className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink"
                />
                <span className="text-sm text-ink-faint">trades</span>
              </div>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-ink-soft">
                Established after
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  name="establishedAfter"
                  type="text"
                  inputMode="numeric"
                  defaultValue={String(policy.establishedAfter)}
                  className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink"
                />
                <span className="text-sm text-ink-faint">trades</span>
              </div>
            </label>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Merchant bond
          </h3>
          <label className="mt-2 block max-w-xs">
            <span className="text-xs font-medium text-ink-soft">
              Minimum bond
            </span>
            <div className="mt-1 flex items-center gap-2">
              <input
                name="minBond"
                type="text"
                inputMode="decimal"
                defaultValue={String(policy.minMerchantBond)}
                className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink"
              />
              <span className="text-sm text-ink-faint">USDT</span>
            </div>
          </label>
        </div>

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
            Trade policy updated.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save trade policy"}
        </button>
      </form>
    </section>
  );
}
