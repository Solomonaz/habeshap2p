import Link from "next/link";
import { Logo } from "@/components/logo";
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from "@/lib/site";

// Organization + WebSite structured data (JSON-LD) so search engines understand
// the brand and can show a richer result. Rendered as a script in the page.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/logo.png`,
      description: SITE_DESCRIPTION,
    },
    {
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_URL,
    },
  ],
};

// The escrow rail is the product's signature: USDT moves Locked → Paid →
// Released, and never auto-releases. The landing hero previews it.
const ESCROW_STAGES = [
  {
    key: "locked",
    label: "Locked",
    note: "Escrow holds the USDT",
    dot: "bg-state-locked",
    text: "text-state-locked",
  },
  {
    key: "paid",
    label: "Paid",
    note: "Buyer sends the Birr",
    dot: "bg-state-paid",
    text: "text-state-paid",
  },
  {
    key: "released",
    label: "Released",
    note: "Seller confirms — funds move",
    dot: "bg-state-released",
    text: "text-state-released",
  },
] as const;

const TRUST_POINTS = [
  {
    title: "Escrow, never auto-released",
    body: "USDT locks the moment a trade opens and only moves when the seller confirms payment — or an admin rules on a dispute. No bot releases your crypto on a buyer's word.",
    icon: (
      <path
        d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z M9.5 12l1.8 1.8L15 10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    ),
  },
  {
    title: "Irreversible rails only",
    body: "Birr settles over Telebirr and trusted banks (CBE, Abyssinia, Awash, Dashen) — rails that can't be clawed back — so a seller who's been paid can release with confidence.",
    icon: (
      <path
        d="M13 3L5 13h5l-1 8 8-10h-5l1-8z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    ),
  },
  {
    title: "Disputes with a human",
    body: "If a paid trade stalls, either side freezes the escrow for an admin to review the chat and payment proof, then release to the buyer or refund the seller.",
    icon: (
      <path
        d="M12 4v16M7 8h10M5 8l-2 5a3 3 0 006 0L7 8m12 0l-2 5a3 3 0 006 0l-2-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    ),
  },
] as const;

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-6 pb-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      {/* Top bar */}
      <header className="flex items-center justify-between py-6">
        <Logo height={36} glow />
        <div className="flex items-center gap-2.5">
          <Link href="/login" className="btn-ghost">
            Sign in
          </Link>
          <Link href="/signup" className="btn-primary">
            Sign up
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="animate-rise pt-12 sm:pt-16">
        <span className="inline-flex items-center gap-2 rounded-full border border-paper-border bg-paper-raised px-3 py-1 text-xs font-medium text-ink-soft">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-buy opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-buy" />
          </span>
          Live P2P order book · USDT / ETB
        </span>
        <h1 className="mt-6 text-balance text-4xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-5xl">
          USDT ↔ ETB, settled with{" "}
          <span className="bg-gradient-to-r from-amber to-amber-soft bg-clip-text text-transparent">
            escrow you can trust.
          </span>
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
          A peer-to-peer exchange for the Ethiopian diaspora. The crypto side is
          held in escrow; Birr settles directly between traders over Telebirr and
          Ethiopian banks.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/signup" className="btn-primary px-5 py-2.5 text-base">
            Start trading
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 12h14M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <Link href="/login" className="btn-ghost px-5 py-2.5 text-base">
            I have an account
          </Link>
        </div>
      </section>

      {/* Signature element: the escrow status rail */}
      <section
        className="panel animate-rise mt-14 p-6 sm:p-8"
        style={{ animationDelay: "80ms" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-muted">Escrow status</h2>
          <span className="rounded-md bg-paper-sunken px-2.5 py-1 font-amount text-sm text-ink">
            100.000000 USDT
          </span>
        </div>

        <ol className="mt-7 flex items-start">
          {ESCROW_STAGES.map((stage, i) => (
            <li key={stage.key} className="flex flex-1 flex-col">
              <div className="flex items-center">
                <span
                  className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-full ${stage.dot} ring-4 ring-paper-raised`}
                />
                {i < ESCROW_STAGES.length - 1 && (
                  <span className="mx-1 h-0.5 flex-1 rounded-full bg-gradient-to-r from-paper-border to-paper-border/40" />
                )}
              </div>
              <span
                className={`mt-3 text-sm font-semibold ${stage.text}`}
              >
                {stage.label}
              </span>
              <span className="mt-1 text-xs leading-snug text-ink-faint">
                {stage.note}
              </span>
            </li>
          ))}
        </ol>

        <p className="mt-7 flex items-center gap-2 border-t border-paper-border pt-5 text-xs text-ink-faint">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-amber">
            <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          Every trade locks USDT here until the seller confirms payment — no
          auto-release, ever.
        </p>
      </section>

      {/* Trust points */}
      <section className="mt-14 grid gap-4 sm:grid-cols-3">
        {TRUST_POINTS.map((p, i) => (
          <div
            key={p.title}
            className="panel animate-rise p-5"
            style={{ animationDelay: `${120 + i * 70}ms` }}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber/25 bg-amber-wash text-amber">
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
                {p.icon}
              </svg>
            </span>
            <h3 className="mt-4 text-sm font-semibold text-ink">{p.title}</h3>
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">{p.body}</p>
          </div>
        ))}
      </section>

      <footer className="mt-16 border-t border-paper-border pt-6 text-xs text-ink-faint">
        <p>
          HabeshaP2P — peer-to-peer USDT ↔ ETB escrow. The platform holds crypto
          in escrow and never takes custody of Birr.
        </p>
      </footer>
    </main>
  );
}
