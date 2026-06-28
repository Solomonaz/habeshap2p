import Image from "next/image";

/**
 * Brand mark — the HabeshaP2P lion-shield logo (served from /public/logo.png).
 *
 * The source asset already carries the wordmark, so `showWordmark` is kept only
 * for call-site compatibility; the image is rendered the same either way. Height
 * is fixed and width is auto so the logo's own aspect ratio is preserved at any
 * size. `priority` keeps it from flashing in on the header/auth screens.
 */
export function Logo({
  height = 36,
  glow = false,
  className = "",
}: {
  showWordmark?: boolean;
  height?: number;
  /** Soft gold halo around the mark, matching the site's amber ambient glow. */
  glow?: boolean;
  className?: string;
}) {
  return (
    <Image
      src="/logo.png"
      alt="HabeshaP2P"
      width={height * 3}
      height={height}
      priority
      style={{
        height,
        width: "auto",
        // drop-shadow follows the PNG's alpha, so the glow hugs the lion-shield
        // shape (not a box). Two layers: a tight bright core + a wide soft bloom.
        ...(glow
          ? {
              filter:
                "drop-shadow(0 0 8px rgba(252,213,53,0.45)) drop-shadow(0 0 22px rgba(240,185,11,0.25))",
            }
          : {}),
      }}
      className={className}
    />
  );
}
