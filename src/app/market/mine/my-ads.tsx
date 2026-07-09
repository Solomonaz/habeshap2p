"use client";

import { useActionState, useEffect, useState } from "react";
import type { AdRow } from "@/lib/ads";
import type { AdStatus } from "@/types/domain";
import { PAYMENT_METHOD_LABELS, SIDE_BADGE } from "@/lib/labels";
import { formatEtb, formatRate } from "@/lib/format";
import {
  setAdStatus,
  updateAdLimits,
  type SetAdStatusState,
  type UpdateAdLimitsState,
} from "./actions";

/** A user's ad plus, for SELL ads, whether the seller's balance can still fund it. */
export type MyAdRow = AdRow & {
  funding?: { available: string; cap: string } | null;
};

const STATUS_STYLE: Record<AdStatus, string> = {
  ACTIVE: "bg-state-released/15 text-state-released",
  PAUSED: "bg-state-locked/15 text-state-locked",
  CLOSED: "bg-ink/10 text-ink-muted",
};

export function MyAds({ ads }: { ads: MyAdRow[] }) {
  if (ads.length === 0) {
    return (
      <p className="mt-8 text-sm text-ink-muted">
        You have no ads yet. Post one from the order book.
      </p>
    );
  }
  return (
    <ul className="mt-6 space-y-3">
      {ads.map((ad) => (
        <AdRowItem key={ad.id} ad={ad} />
      ))}
    </ul>
  );
}

function AdRowItem({ ad }: { ad: MyAdRow }) {
  const [state, formAction, pending] = useActionState<
    SetAdStatusState,
    FormData
  >(setAdStatus, {});
  const [editing, setEditing] = useState(false);
  const underfunded = ad.status !== "CLOSED" && !!ad.funding;

  return (
    <li className="rounded-card border border-paper-border bg-paper-raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded bg-paper-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink">
              {SIDE_BADGE[ad.side]} USDT
            </span>
            <span
              className={
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                STATUS_STYLE[ad.status]
              }
            >
              {ad.status}
            </span>
          </div>
          <p className="mt-2 font-amount text-lg text-ink">
            {formatRate(ad.rate_etb)}{" "}
            <span className="text-sm text-ink-muted">ETB / USDT</span>
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">
            Limits{" "}
            <span className="font-amount">
              {formatEtb(ad.min_etb)}–{formatEtb(ad.max_etb)} ETB
            </span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ad.payment_methods.map((m) => (
              <span
                key={m}
                className="rounded bg-paper-sunken px-2 py-0.5 text-[11px] text-ink-soft"
              >
                {PAYMENT_METHOD_LABELS[m]}
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {ad.status !== "CLOSED" && (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="rounded-md border border-paper-border px-3 py-1.5 text-sm text-ink-soft transition-colors hover:bg-paper-sunken"
            >
              {editing ? "Cancel" : "Edit limits"}
            </button>
          )}
          {ad.status !== "CLOSED" && (
            <form action={formAction} className="flex gap-2">
              <input type="hidden" name="adId" value={ad.id} />
              {ad.status === "ACTIVE" ? (
                <StatusButton
                  value="PAUSED"
                  pending={pending}
                  className="border-paper-border text-ink-soft hover:bg-paper-sunken"
                >
                  Pause
                </StatusButton>
              ) : (
                <StatusButton
                  value="ACTIVE"
                  pending={pending}
                  className="border-paper-border text-ink-soft hover:bg-paper-sunken"
                >
                  Activate
                </StatusButton>
              )}
              <StatusButton
                value="CLOSED"
                pending={pending}
                className="border-state-disputed/40 text-state-disputed hover:bg-state-disputed/10"
              >
                Close
              </StatusButton>
            </form>
          )}
        </div>
      </div>

      {/* Underfunded warning: the seller's balance can't cover this ad's max. */}
      {underfunded && !editing && (
        <div className="mt-3 rounded-md border border-amber/40 bg-amber-wash px-3 py-2.5 text-xs text-ink-soft">
          <p className="font-medium text-amber">Update this ad&apos;s limit</p>
          <p className="mt-0.5">
            Your {ad.funding!.available} USDT balance can&apos;t cover the{" "}
            {formatEtb(ad.max_etb)} ETB max at this rate. Buyers may fail to open
            orders. Lower the max to {formatEtb(ad.funding!.cap)} ETB or less, or
            deposit more USDT.
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-2 rounded-md bg-amber px-3 py-1.5 text-xs font-semibold text-paper hover:opacity-90"
          >
            Update limits
          </button>
        </div>
      )}

      {editing && (
        <EditLimitsForm ad={ad} onDone={() => setEditing(false)} />
      )}

      {state.error && (
        <p role="alert" className="mt-2 text-xs text-state-disputed">
          {state.error}
        </p>
      )}
    </li>
  );
}

function EditLimitsForm({ ad, onDone }: { ad: MyAdRow; onDone: () => void }) {
  const [state, formAction, pending] = useActionState<
    UpdateAdLimitsState,
    FormData
  >(updateAdLimits, {});

  // Close the editor once the save succeeds (the page has revalidated).
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form
      action={formAction}
      className="mt-3 rounded-md border border-paper-border bg-paper-sunken/50 p-3"
    >
      <input type="hidden" name="adId" value={ad.id} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field
          label="Price (ETB / USDT)"
          name="rate_etb"
          defaultValue={ad.rate_etb}
        />
        <Field label="Min (ETB)" name="min_etb" defaultValue={ad.min_etb} />
        <Field label="Max (ETB)" name="max_etb" defaultValue={ad.max_etb} />
      </div>
      {ad.side === "SELL" && (
        <p className="mt-2 text-[11px] text-ink-faint">
          For a sell ad, the max can&apos;t exceed what your USDT balance covers
          at this rate.
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-2 text-xs text-state-disputed">
          {state.error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-1.5 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save limits"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-paper-border px-4 py-1.5 text-sm text-ink-soft hover:bg-paper-sunken"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-medium text-ink-soft">
        {label}
      </span>
      <input
        type="text"
        name={name}
        inputMode="decimal"
        defaultValue={defaultValue}
        autoComplete="off"
        className="w-full rounded-md border border-paper-border bg-paper px-3 py-1.5 font-amount text-sm text-ink focus:border-amber focus:outline-none"
      />
    </label>
  );
}

function StatusButton({
  value,
  pending,
  className,
  children,
}: {
  value: AdStatus;
  pending: boolean;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      name="status"
      value={value}
      disabled={pending}
      className={
        "rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 " +
        className
      }
    >
      {children}
    </button>
  );
}
