import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { fetchOrder } from "@/lib/orders";
import { fetchMessages } from "@/lib/messages";
import { fetchDisputeForOrder } from "@/lib/disputes";
import { SiteHeader } from "@/components/site-header";
import { EscrowRail } from "@/components/escrow-rail";
import { formatUsdt } from "@/lib/money";
import { formatEtb, formatRate } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { traderHandle } from "@/lib/handle";
import { OrderControls } from "./order-controls";
import { OrderChat } from "./order-chat";

export default async function OrderPage({
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

  const order = await fetchOrder(supabase, id);
  if (!order) notFound();

  const isBuyer = order.buyer_id === user.id;
  const isSeller = order.seller_id === user.id;
  const role = isBuyer ? "You are buying" : "You are selling";

  const messages = await fetchMessages(supabase, order.id);
  const counterpartyId = isBuyer ? order.seller_id : order.buyer_id;

  const disputeRow =
    order.state === "DISPUTED"
      ? await fetchDisputeForOrder(supabase, order.id)
      : null;
  const dispute = disputeRow
    ? { reason: disputeRow.reason, openedByMe: disputeRow.opened_by === user.id }
    : null;

  return (
    <>
      <SiteHeader phone={user.phone} active="orders" userId={user.id} />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <Link href="/orders" className="text-sm text-ink-muted hover:text-ink">
          ← All orders
        </Link>

        <div className="mt-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink">
              <span className="font-amount">{formatUsdt(order.amount_usdt)}</span>{" "}
              USDT
            </h1>
            <p className="mt-0.5 text-sm text-ink-muted">{role}</p>
          </div>
          <span className="rounded bg-paper-sunken px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            {order.state}
          </span>
        </div>

        <section className="mt-6 rounded-card border border-paper-border bg-paper-raised p-6">
          <h2 className="text-sm font-medium text-ink-muted">Escrow status</h2>
          <div className="mt-4">
            <EscrowRail state={order.state} />
          </div>
        </section>

        <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-6">
          <dl className="space-y-2.5 text-sm">
            <Row label="Amount">
              <span className="font-amount text-ink">
                {formatUsdt(order.amount_usdt)} USDT
              </span>
            </Row>
            <Row label="Price">
              <span className="font-amount text-ink-soft">
                {formatRate(order.rate_etb)} ETB / USDT
              </span>
            </Row>
            <Row label={isBuyer ? "You pay" : "You receive"}>
              <span className="font-amount text-ink">
                {formatEtb(order.amount_etb)} ETB
              </span>
            </Row>
            <Row label="Payment method">
              <span className="text-ink-soft">
                {PAYMENT_METHOD_LABELS[order.payment_method]}
              </span>
            </Row>
            {order.state === "RELEASED" && (
              <Row label="Taker fee">
                <span className="font-amount text-ink-faint">
                  {formatUsdt(order.fee_usdt)} USDT
                </span>
              </Row>
            )}
          </dl>

          {/* Real-name matching (rule #2) — emphasised for the seller. */}
          <div
            className={
              "mt-4 rounded-md px-3 py-2.5 text-sm " +
              (isSeller
                ? "border border-amber/40 bg-amber-wash"
                : "bg-paper-sunken")
            }
          >
            <p className="text-ink-muted">Buyer pays from</p>
            <p className="mt-0.5 font-medium text-ink">
              {order.buyer_payment_name}
            </p>
            {isSeller && (
              <p className="mt-1 text-xs text-amber">
                Release only if the ETB arrives from this exact name. Refuse on
                any mismatch.
              </p>
            )}
          </div>
        </section>

        <section className="mt-4">
          <OrderControls
            orderId={order.id}
            state={order.state}
            isBuyer={isBuyer}
            isSeller={isSeller}
            expiresAt={order.expires_at}
            amountEtb={formatEtb(order.amount_etb)}
            buyerPaymentName={order.buyer_payment_name}
            dispute={dispute}
          />
        </section>

        <OrderChat
          orderId={order.id}
          currentUserId={user.id}
          initialMessages={messages}
          counterpartyLabel={traderHandle(counterpartyId)}
        />
      </main>
    </>
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
