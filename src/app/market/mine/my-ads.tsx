"use client";

import { useActionState } from "react";
import type { AdRow } from "@/lib/ads";
import type { AdStatus } from "@/types/domain";
import { PAYMENT_METHOD_LABELS, SIDE_BADGE } from "@/lib/labels";
import { formatEtb, formatRate } from "@/lib/format";
import { setAdStatus, type SetAdStatusState } from "./actions";

const STATUS_STYLE: Record<AdStatus, string> = {
  ACTIVE: "bg-state-released/15 text-state-released",
  PAUSED: "bg-state-locked/15 text-state-locked",
  CLOSED: "bg-ink/10 text-ink-muted",
};

export function MyAds({ ads }: { ads: AdRow[] }) {
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

function AdRowItem({ ad }: { ad: AdRow }) {
  const [state, formAction, pending] = useActionState<
    SetAdStatusState,
    FormData
  >(setAdStatus, {});

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

        {ad.status !== "CLOSED" && (
          <form action={formAction} className="flex shrink-0 gap-2">
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

      {state.error && (
        <p role="alert" className="mt-2 text-xs text-state-disputed">
          {state.error}
        </p>
      )}
    </li>
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
