/**
 * Brand mark + wordmark. The mark is a gold tile carrying a bidirectional swap
 * glyph (peer-to-peer exchange); the wordmark splits "Habesha" (light) from
 * "P2P" (gold) for a two-tone lockup. Pure presentational — safe in any tree.
 */
export function Logo({
  showWordmark = true,
  className = "",
}: {
  showWordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={"inline-flex items-center gap-2.5 " + className}>
      <span
        aria-hidden
        className="relative flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-amber to-amber-soft shadow-[0_8px_20px_-8px_rgba(240,185,11,0.7)]"
      >
        {/* subtle top sheen */}
        <span className="pointer-events-none absolute inset-0 rounded-[10px] bg-gradient-to-b from-white/30 to-transparent opacity-60" />
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          className="relative"
        >
          {/* swap / exchange arrows */}
          <path
            d="M4 9.5h12l-3.2-3.2M20 14.5H8l3.2 3.2"
            stroke="#181a20"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {showWordmark && (
        <span className="text-[15px] font-bold leading-none tracking-tight text-ink">
          Habesha<span className="text-amber">P2P</span>
        </span>
      )}
    </span>
  );
}
