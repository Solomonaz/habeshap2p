/**
 * A collapsible "How it works" panel embedded next to a flow (deposit, send,
 * withdraw, trade). Uses a native <details>/<summary> so it needs no client JS and
 * renders on the server — the chevron rotates via the `open:` group variant. Each
 * screen supplies its own step content as children.
 */
export function HowItWorks({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="group mt-4 overflow-hidden rounded-card border border-paper-border bg-paper-raised/60 open:bg-paper-raised"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber/15 text-xs font-bold text-amber">
          ?
        </span>
        <span className="flex-1">{title}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="shrink-0 text-ink-faint transition-transform duration-200 group-open:rotate-180"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-paper-border px-4 py-4 text-sm leading-relaxed text-ink-soft">
        {children}
      </div>
    </details>
  );
}

/** An ordered list of steps for a guide body. Each item is one step. */
export function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-paper-sunken text-[11px] font-bold text-ink-muted">
            {i + 1}
          </span>
          <span className="flex-1">{item}</span>
        </li>
      ))}
    </ol>
  );
}

/** A small tinted callout for a tip or a warning inside a guide. */
export function Callout({
  tone = "note",
  children,
}: {
  tone?: "note" | "warn";
  children: React.ReactNode;
}) {
  const styles =
    tone === "warn"
      ? "border-sell/40 bg-sell-wash text-ink-soft"
      : "border-amber/40 bg-amber-wash text-ink-soft";
  return (
    <p className={"mt-3 rounded-md border px-3 py-2 text-xs " + styles}>
      {children}
    </p>
  );
}
