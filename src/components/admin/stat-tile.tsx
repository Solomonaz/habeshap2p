import Link from "next/link";

/**
 * A dashboard metric tile: label + big number + an icon chip, with a subtle
 * hover lift. Optionally a link (the whole tile becomes clickable) and an accent
 * tone that tints the icon + value for tiles that need attention (e.g. open
 * disputes). Pure presentational — callers pass already-formatted values.
 */
type Tone = "neutral" | "amber" | "buy" | "sell";

const TONE: Record<Tone, { chip: string; value: string }> = {
  neutral: { chip: "bg-paper-sunken text-ink-soft", value: "text-ink" },
  amber: { chip: "bg-amber/15 text-amber", value: "text-ink" },
  buy: { chip: "bg-buy/15 text-buy", value: "text-ink" },
  sell: { chip: "bg-sell/15 text-sell", value: "text-sell" },
};

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  tone?: Tone;
  href?: string;
}) {
  const t = TONE[tone];
  const inner = (
    <div className="panel h-full p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-ink-faint/40 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-ink-muted">{label}</p>
        {icon && (
          <span
            className={
              "flex h-8 w-8 items-center justify-center rounded-lg " + t.chip
            }
          >
            {icon}
          </span>
        )}
      </div>
      <p className={"mt-2 font-amount text-2xl font-semibold sm:text-3xl " + t.value}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );

  return href ? (
    <Link href={href} className="block focus-visible:outline-none">
      {inner}
    </Link>
  ) : (
    inner
  );
}
