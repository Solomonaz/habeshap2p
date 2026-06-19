const ESCROW_STAGES = [
  { key: "locked", label: "Locked", tone: "text-state-locked" },
  { key: "paid", label: "Paid", tone: "text-state-paid" },
  { key: "released", label: "Released", tone: "text-state-released" },
] as const;

const TRUST_POINTS = [
  {
    title: "Escrow, never auto-released",
    body: "USDT locks the moment a trade opens and only moves when the seller confirms payment — or an admin rules on a dispute. No bot releases your crypto on a buyer's word.",
  },
  {
    title: "Irreversible rails only",
    body: "Birr settles over Telebirr and trusted banks (CBE, Abyssinia, Awash, Dashen) — rails that can't be clawed back — so a seller who's been paid can release with confidence.",
  },
  {
    title: "Disputes with a human",
    body: "If a paid trade stalls, either side freezes the escrow for an admin to review the chat and payment proof, then release to the buyer or refund the seller.",
  },
] as const;

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium uppercase tracking-wide text-ink-muted">
          HabeshaP2P
        </p>
        <a
          href="/login"
          className="rounded-md bg-amber px-4 py-1.5 text-sm font-medium text-paper-raised transition-colors hover:bg-amber-soft"
        >
          Sign in
        </a>
      </div>
      <h1 className="mt-2 text-3xl font-semibold text-ink sm:text-4xl">
        USDT ↔ ETB, settled with escrow you can trust.
      </h1>
      <p className="mt-4 max-w-xl text-ink-soft">
        A peer-to-peer exchange for the Ethiopian diaspora. The crypto side is
        held in escrow; Birr settles directly between traders over Telebirr and
        Ethiopian banks.
      </p>

      {/* Signature element preview: the escrow status rail. */}
      <section className="mt-12 rounded-card border border-paper-border bg-paper-raised p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-muted">Escrow status</h2>
          <span className="font-amount text-sm text-ink-soft">
            100.000000 USDT
          </span>
        </div>
        <ol className="mt-5 flex items-center gap-2">
          {ESCROW_STAGES.map((stage, i) => (
            <li key={stage.key} className="flex flex-1 items-center gap-2">
              <span
                className={`text-xs font-semibold uppercase tracking-wide ${stage.tone}`}
              >
                {stage.label}
              </span>
              {i < ESCROW_STAGES.length - 1 && (
                <span className="h-px flex-1 bg-paper-border" aria-hidden />
              )}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-ink-faint">
          Every trade locks USDT here until the seller confirms payment — no
          auto-release, ever.
        </p>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        {TRUST_POINTS.map((p) => (
          <div
            key={p.title}
            className="rounded-card border border-paper-border bg-paper-raised p-5"
          >
            <h3 className="text-sm font-semibold text-ink">{p.title}</h3>
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
