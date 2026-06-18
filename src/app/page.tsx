const ESCROW_STAGES = [
  { key: "locked", label: "Locked", tone: "text-state-locked" },
  { key: "paid", label: "Paid", tone: "text-state-paid" },
  { key: "released", label: "Released", tone: "text-state-released" },
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
        CBE.
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
    </main>
  );
}
