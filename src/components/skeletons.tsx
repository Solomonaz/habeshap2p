/**
 * Route-level loading skeletons.
 *
 * Next renders the nearest `loading.tsx` the instant a navigation starts, while
 * the server component (and its data fetches) stream in. Without it the browser
 * sits on the previous screen after a click and the app feels frozen — which is
 * most of the "it's slow" perception, especially in `next dev`. These give an
 * immediate, layout-matched placeholder so navigation feels instant.
 *
 * Pure presentational + server-renderable (no client JS), so they cost nothing.
 */

/** A single shimmering placeholder block. Width/height via className. */
export function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} />;
}

/**
 * A static stand-in for <SiteHeader> while the real (async) header resolves.
 * Matches its height and layout so there's no jump when the page swaps in.
 */
export function HeaderSkeleton() {
  return (
    <header className="sticky top-0 z-40 border-b border-paper-border/70 bg-paper/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-7">
          <Shimmer className="h-7 w-32" />
          <div className="hidden items-center gap-2 md:flex">
            <Shimmer className="h-5 w-16" />
            <Shimmer className="h-5 w-16" />
            <Shimmer className="h-5 w-16" />
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Shimmer className="hidden h-8 w-40 rounded-full sm:block" />
          <Shimmer className="h-8 w-20" />
        </div>
      </div>
    </header>
  );
}

/** Convenience wrapper: header skeleton + a centred main column. */
export function PageSkeleton({
  children,
  maxWidth = "max-w-5xl",
}: {
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <>
      <HeaderSkeleton />
      <main className={`mx-auto ${maxWidth} px-4 py-8 sm:px-6 sm:py-10`}>
        {children}
      </main>
    </>
  );
}

/** A card-shaped placeholder echoing an order-book / list row. */
export function CardSkeleton() {
  return (
    <div className="rounded-xl border border-paper-border bg-paper-sunken/30 p-5">
      <div className="flex items-center gap-2.5">
        <Shimmer className="h-9 w-9 rounded-full" />
        <div className="space-y-1.5">
          <Shimmer className="h-4 w-32" />
          <Shimmer className="h-3 w-24" />
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="space-y-2.5">
          <Shimmer className="h-7 w-28" />
          <Shimmer className="h-3 w-44" />
          <Shimmer className="h-3 w-40" />
        </div>
        <Shimmer className="h-10 w-28 rounded-lg" />
      </div>
    </div>
  );
}
