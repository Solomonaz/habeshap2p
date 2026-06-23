"use client";

import { useActionState } from "react";
import { formatUsdt } from "@/lib/money";
import {
  formatTradeLimit,
  tierLabel,
  type ReputationTier,
} from "@/lib/reputation";
import {
  postBondAction,
  releaseBondAction,
  type MerchantState,
} from "./actions";

/**
 * Merchant-bond panel (Phase 6, rule #5). Shows the user's current trade tier
 * and per-order cap, and lets them post collateral to become a merchant (and
 * lift the cap) or release it. The authoritative checks live in SQL — this is
 * the UI over the postBond/releaseBond server actions.
 */
export function MerchantBond({
  isMerchant,
  tier,
  tradeLimit,
  bond,
  available,
  minBond,
}: {
  isMerchant: boolean;
  tier: ReputationTier;
  tradeLimit: number | null;
  bond: string;
  available: string;
  minBond: number;
}) {
  const [postState, postAction, posting] = useActionState<
    MerchantState,
    FormData
  >(postBondAction, {});
  const [releaseState, releaseAction, releasing] = useActionState<
    MerchantState,
    FormData
  >(releaseBondAction, {});

  return (
    <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink-muted">Merchant status</h2>
        <span
          className={
            "rounded-full px-2.5 py-0.5 text-xs font-medium " +
            (isMerchant
              ? "bg-buy-wash text-buy"
              : "bg-paper-sunken text-ink-soft")
          }
        >
          {tierLabel(tier)}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-xs text-ink-faint">Per-order limit</dt>
          <dd className="font-amount text-lg text-ink">
            {formatTradeLimit(tradeLimit)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">Bond posted</dt>
          <dd className="font-amount text-lg text-state-locked">
            {formatUsdt(bond)}
          </dd>
        </div>
      </dl>

      {isMerchant ? (
        <form action={releaseAction} className="mt-4">
          <p className="text-xs text-ink-faint">
            Releasing your bond returns {formatUsdt(bond)} to your available
            balance and drops your merchant status. You cannot release while you
            have open orders.
          </p>
          {releaseState.error && (
            <p
              role="alert"
              className="mt-2 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-sell"
            >
              {releaseState.error}
            </p>
          )}
          <button
            type="submit"
            disabled={releasing}
            className="mt-3 rounded-md border border-paper-border px-4 py-1.5 text-sm text-ink-soft hover:bg-paper-sunken disabled:opacity-60"
          >
            {releasing ? "Releasing…" : "Release bond"}
          </button>
        </form>
      ) : (
        <form action={postAction} className="mt-4">
          <p className="text-xs text-ink-faint">
            Lock at least{" "}
            <span className="font-amount text-ink">{minBond} USDT</span> as
            collateral to become a merchant and trade without per-order limits.
            The bond stays yours — it&apos;s held in escrow and released when you
            step down.
          </p>
          {postState.error && (
            <p
              role="alert"
              className="mt-2 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-sell"
            >
              {postState.error}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              name="amount"
              defaultValue={String(minBond)}
              inputMode="decimal"
              className="w-32 rounded-md border border-paper-border bg-paper px-3 py-1.5 font-amount text-sm text-ink focus:border-buy focus:outline-none"
            />
            <button
              type="submit"
              disabled={posting}
              className="rounded-md bg-buy px-4 py-1.5 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-60"
            >
              {posting ? "Posting…" : "Post bond"}
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            Available to bond: {formatUsdt(available)}
          </p>
        </form>
      )}
    </section>
  );
}
