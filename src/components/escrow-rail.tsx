import type { OrderState } from "@/types/domain";

/**
 * The signature escrow status rail: Locked → Paid → Released. Terminal
 * CANCELLED / DISPUTED states are shown explicitly rather than on the happy path.
 */
const STAGES = [
  { key: "locked", label: "Locked", hint: "USDT held in escrow" },
  { key: "paid", label: "Paid", hint: "Buyer sent ETB" },
  { key: "released", label: "Released", hint: "Seller confirmed" },
] as const;

function activeIndex(state: OrderState): number {
  switch (state) {
    case "CREATED":
      return 0;
    case "PAID":
    case "DISPUTED":
      return 1;
    case "RELEASED":
      return 2;
    default:
      return 0;
  }
}

export function EscrowRail({ state }: { state: OrderState }) {
  if (state === "CANCELLED") {
    return (
      <div className="rounded-md border border-paper-border bg-paper-sunken px-4 py-3 text-sm text-state-cancelled">
        Order cancelled — escrowed USDT was returned to the seller.
      </div>
    );
  }

  const idx = activeIndex(state);
  const disputed = state === "DISPUTED";

  return (
    <div>
      <ol className="flex items-center">
        {STAGES.map((stage, i) => {
          const done = i < idx || state === "RELEASED";
          const current = i === idx && state !== "RELEASED";
          const tone = disputed
            ? "text-state-disputed"
            : done
              ? "text-state-released"
              : current
                ? "text-state-paid"
                : "text-ink-faint";
          const dot = disputed
            ? "bg-state-disputed"
            : done
              ? "bg-state-released"
              : current
                ? "bg-state-paid"
                : "bg-paper-border";
          return (
            <li key={stage.key} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <span className={`h-3 w-3 rounded-full ${dot}`} aria-hidden />
                <span
                  className={`text-[11px] font-semibold uppercase tracking-wide ${tone}`}
                >
                  {stage.label}
                </span>
              </div>
              {i < STAGES.length - 1 && (
                <span
                  className={`mx-2 mb-4 h-px flex-1 ${
                    i < idx ? "bg-state-released" : "bg-paper-border"
                  }`}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
      {disputed && (
        <p className="mt-3 rounded-md border border-state-disputed/40 bg-sell-wash px-3 py-2 text-xs text-state-disputed">
          This order is in dispute. Escrow is frozen until an admin rules.
        </p>
      )}
    </div>
  );
}
