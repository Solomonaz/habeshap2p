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
  className = "",
}: {
  showWordmark?: boolean;
  height?: number;
  className?: string;
}) {
  return (
    <Image
      src="/logo.png"
      alt="HabeshaP2P"
      width={height * 3}
      height={height}
      priority
      style={{ height, width: "auto" }}
      className={className}
    />
  );
}
