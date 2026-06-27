"use client";

import { useActionState } from "react";
import {
  freezeEnergyAction,
  unfreezeEnergyAction,
  type EnergyStakeState,
} from "../actions";
import type { EnergySnapshot } from "@/lib/chain";

/**
 * Hot-wallet Energy stake controls (migration 0029, staking strategy). Shows the
 * current frozen TRX / available Energy and lets the admin freeze more or
 * unfreeze. Only meaningful when live payments are on and the strategy is staking.
 */
export function EnergyStakeForm({
  energy,
  live,
  error,
}: {
  energy: EnergySnapshot | null;
  live: boolean;
  error: string | null;
}) {
  const [freezeState, freezeFormAction, freezing] = useActionState<
    EnergyStakeState,
    FormData
  >(freezeEnergyAction, {});
  const [unfreezeState, unfreezeFormAction, unfreezing] = useActionState<
    EnergyStakeState,
    FormData
  >(unfreezeEnergyAction, {});

  return (
    <section className="mt-6 rounded-card border border-paper-border bg-paper-raised p-5">
      <h2 className="text-sm font-medium text-ink">Hot-wallet Energy stake</h2>
      <p className="mt-1 text-xs text-ink-faint">
        TRX frozen for Energy is delegated to deposit addresses during a staking
        sweep, then reclaimed. The TRX is locked, never spent.
      </p>

      {!live ? (
        <p className="mt-3 rounded-md border border-amber/40 bg-amber-wash px-3 py-2 text-xs text-amber">
          Enable live payments to view and manage the hot-wallet Energy stake.
        </p>
      ) : error ? (
        <p className="mt-3 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-xs text-sell">
          {error}
        </p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
          <div className="rounded-md border border-paper-border bg-paper p-3">
            <dt className="text-xs text-ink-faint">Frozen TRX</dt>
            <dd className="font-amount text-lg text-ink">
              {energy?.frozenTrx ?? "0"}
            </dd>
          </div>
          <div className="rounded-md border border-paper-border bg-paper p-3">
            <dt className="text-xs text-ink-faint">Energy available</dt>
            <dd className="font-amount text-lg text-ink">
              {(energy?.energyAvailable ?? 0).toLocaleString()}
            </dd>
          </div>
          <div className="rounded-md border border-paper-border bg-paper p-3">
            <dt className="text-xs text-ink-faint">Energy limit</dt>
            <dd className="font-amount text-lg text-ink">
              {(energy?.energyLimit ?? 0).toLocaleString()}
            </dd>
          </div>
        </dl>
      )}

      {live && !error && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <form action={freezeFormAction} className="space-y-2">
            <label className="block text-xs font-medium text-ink-soft">
              Freeze TRX for Energy
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                name="amount"
                inputMode="decimal"
                placeholder="1000"
                className="w-32 rounded-md border border-paper-border bg-paper px-3 py-1.5 font-amount text-sm text-ink focus:border-buy focus:outline-none"
              />
              <button
                type="submit"
                disabled={freezing}
                className="rounded-md bg-buy px-3 py-1.5 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
              >
                {freezing ? "Freezing…" : "Freeze"}
              </button>
            </div>
            {freezeState.error && (
              <p role="alert" className="text-xs text-sell">
                {freezeState.error}
              </p>
            )}
            {freezeState.ok && (
              <p role="status" className="break-all text-xs text-buy">
                Frozen. tx {freezeState.txHash}
              </p>
            )}
          </form>

          <form action={unfreezeFormAction} className="space-y-2">
            <label className="block text-xs font-medium text-ink-soft">
              Unfreeze TRX (unlock delay applies)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                name="amount"
                inputMode="decimal"
                placeholder="1000"
                className="w-32 rounded-md border border-paper-border bg-paper px-3 py-1.5 font-amount text-sm text-ink focus:border-amber focus:outline-none"
              />
              <button
                type="submit"
                disabled={unfreezing}
                className="rounded-md bg-amber px-3 py-1.5 text-sm font-semibold text-paper hover:bg-amber-soft disabled:opacity-50"
              >
                {unfreezing ? "Unfreezing…" : "Unfreeze"}
              </button>
            </div>
            {unfreezeState.error && (
              <p role="alert" className="text-xs text-sell">
                {unfreezeState.error}
              </p>
            )}
            {unfreezeState.ok && (
              <p role="status" className="break-all text-xs text-buy">
                Unfreeze submitted. tx {unfreezeState.txHash}
              </p>
            )}
          </form>
        </div>
      )}
    </section>
  );
}
