import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { fetchDisputeDetailForAdmin } from "@/lib/disputes";
import { formatUsdt } from "@/lib/money";
import { formatEtb, formatRate } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { traderHandle } from "@/lib/handle";
import { AdminResolve } from "./admin-resolve";
import { ReinstateAccount } from "../../accounts/reinstate";

export const dynamic = "force-dynamic";

export default async function AdminDisputePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdmin(supabase, user.id))) redirect("/market");

  const detail = await fetchDisputeDetailForAdmin(id);
  if (!detail) notFound();
  const { dispute, order, messages, sellerStanding } = detail;
  const sellerFrozen = sellerStanding.accountStatus === "FROZEN";
  const sellerBanned = sellerStanding.accountStatus === "BANNED";

  const buyerLabel = `Buyer · ${traderHandle(order.buyer_id)}`;
  const sellerLabel = `Seller · ${traderHandle(order.seller_id)}`;
  const resolved = dispute.status === "RESOLVED";

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        <Link href="/admin/disputes" className="text-sm text-ink-muted hover:text-ink">
          ← Dispute queue
        </Link>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-ink">
            <span className="font-amount">{formatUsdt(order.amount_usdt)}</span>{" "}
            USDT in dispute
          </h1>
          <span className="rounded bg-sell-wash px-2 py-1 text-xs font-semibold uppercase tracking-wide text-state-disputed">
            {dispute.status}
          </span>
        </div>

        {/* The claim */}
        <section className="mt-6 rounded-card border border-paper-border bg-paper-raised p-5 sm:p-6">
          <h2 className="text-sm font-medium text-ink-muted">
            Dispute opened by{" "}
            {dispute.opened_by === order.buyer_id ? "the buyer" : "the seller"}
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
            {dispute.reason}
          </p>
        </section>

        {/* Order facts the ruling turns on */}
        <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5 sm:p-6">
          <dl className="space-y-2.5 text-sm">
            <Row label="Amount">
              <span className="font-amount text-ink">
                {formatUsdt(order.amount_usdt)} USDT
              </span>
            </Row>
            <Row label="Fiat leg">
              <span className="font-amount text-ink-soft">
                {formatEtb(order.amount_etb)} ETB @ {formatRate(order.rate_etb)}
              </span>
            </Row>
            <Row label="Payment rail">
              <span className="text-ink-soft">
                {PAYMENT_METHOD_LABELS[order.payment_method]}
              </span>
            </Row>
            <Row label="Buyer pays from">
              <span className="font-medium text-ink">
                {order.buyer_payment_name}
              </span>
            </Row>
            <Row label="Buyer marked paid">
              <span className="text-ink-soft">
                {order.paid_at ? (
                  new Date(order.paid_at).toLocaleString()
                ) : (
                  <span className="text-state-disputed">never</span>
                )}
              </span>
            </Row>
            <Row label="Buyer">
              <span className="text-ink-soft">{traderHandle(order.buyer_id)}</span>
            </Row>
            <Row label="Seller">
              <span className="text-ink-soft">
                {traderHandle(order.seller_id)}
              </span>
            </Row>
          </dl>
          <p className="mt-3 rounded-md bg-paper-sunken px-3 py-2 text-xs text-ink-faint">
            The seller&apos;s {formatUsdt(order.amount_usdt)} USDT is locked in
            escrow. Ruling for the buyer releases the full amount to them; ruling
            for the seller returns it. No fee is taken on a dispute.
          </p>
        </section>

        {/* Evidence: the immutable chat transcript + proof images */}
        <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5 sm:p-6">
          <h2 className="text-sm font-medium text-ink-muted">
            Chat &amp; payment proof
          </h2>
          {messages.length === 0 ? (
            <p className="mt-3 text-sm text-ink-faint">
              No messages were exchanged on this order.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {messages.map((m) => {
                const fromBuyer = m.sender_id === order.buyer_id;
                return (
                  <li
                    key={m.id}
                    className="rounded-md border border-paper-border bg-paper-sunken px-3 py-2"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                      {fromBuyer ? buyerLabel : sellerLabel} ·{" "}
                      {new Date(m.created_at).toLocaleString()}
                    </p>
                    {m.body && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                        {m.body}
                      </p>
                    )}
                    {m.proofUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.proofUrl}
                        alt="Payment proof"
                        className="mt-2 max-h-80 rounded-md border border-paper-border"
                      />
                    )}
                    {m.image_url && !m.proofUrl && (
                      <p className="mt-1 text-xs text-state-disputed">
                        (proof image could not be loaded)
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mt-4 space-y-4">
          {resolved ? (
            <p className="rounded-md border border-state-released/40 bg-buy-wash px-4 py-3 text-sm text-state-released">
              Resolved{" "}
              {dispute.resolution === "FAVOUR_BUYER"
                ? "in favour of the buyer — USDT was released to them."
                : "in favour of the seller — escrow was returned."}{" "}
              {dispute.resolved_at &&
                `(${new Date(dispute.resolved_at).toLocaleString()})`}
            </p>
          ) : (
            <AdminResolve
              disputeId={dispute.id}
              buyerLabel={traderHandle(order.buyer_id)}
              sellerLabel={traderHandle(order.seller_id)}
              amountUsdt={formatUsdt(order.amount_usdt)}
              sellerFrozen={sellerFrozen}
              frozenUsdt={formatUsdt(sellerStanding.frozenUsdt)}
            />
          )}

          {/* Appeal path: a banned seller can be reinstated even after the
              dispute is resolved (e.g. the buyer was later found to have lied
              about paying). This record stays open for that review. */}
          {sellerBanned && (
            <ReinstateAccount
              userId={order.seller_id}
              disputeId={dispute.id}
              forfeitedUsdt={formatUsdt(sellerStanding.forfeitedUsdt)}
            />
          )}
        </section>
    </main>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
