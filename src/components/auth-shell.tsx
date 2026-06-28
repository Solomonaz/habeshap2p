import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

/**
 * Split-screen auth layout: the form on the left, a branded marketing panel on
 * the right. The right panel is hidden below `lg` so phones get a clean,
 * full-width form. Kept on the app's dark paper theme (rather than the light
 * panel in the reference mock) so sign-in is visually continuous with the rest
 * of the app instead of a jarring white interstitial.
 */
const POINTS = [
  {
    title: "Escrow, never auto-released",
    body: "USDT only moves when the seller confirms payment — or an admin rules on a dispute.",
  },
  {
    title: "Irreversible rails only",
    body: "Birr settles over Telebirr and trusted banks that can't be clawed back.",
  },
  {
    title: "A human on disputes",
    body: "If a paid trade stalls, an admin reviews the chat and proof before anything releases.",
  },
] as const;

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Form column */}
      <div className="flex flex-col px-6 py-10 sm:px-10">
        <Link href="/" aria-label="HabeshaP2P home" className="w-fit">
          <Logo height={56} glow />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>

      {/* Marketing column */}
      <aside className="relative hidden overflow-hidden border-l border-paper-border bg-paper-raised lg:flex lg:flex-col lg:justify-center lg:px-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(42rem 30rem at 80% -10%, rgba(252,213,53,0.12), transparent 60%), radial-gradient(36rem 28rem at 0% 110%, rgba(14,203,129,0.07), transparent 60%)",
          }}
        />
        <div className="relative z-10 max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber">
            USDT ↔ ETB
          </p>
          <h2 className="mt-4 text-3xl font-semibold leading-tight text-ink">
            The escrow exchange built for the Ethiopian diaspora.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            Crypto is held in escrow until the seller confirms payment. Birr
            settles directly between traders over Telebirr and Ethiopian banks.
          </p>
          <ul className="mt-10 space-y-6">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-amber" />
                <div>
                  <h3 className="text-sm font-semibold text-ink">{p.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                    {p.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  );
}
