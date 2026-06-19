import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { fetchMyOrders } from "@/lib/orders";
import { SiteHeader } from "@/components/site-header";
import { accountLabel } from "@/lib/identity";
import { formatUsdt } from "@/lib/money";
import { formatEtb } from "@/lib/format";
import type { OrderState } from "@/types/domain";

const STATE_STYLE: Record<OrderState, string> = {
  CREATED: "bg-state-locked/15 text-state-locked",
  PAID: "bg-amber-wash text-amber",
  RELEASED: "bg-buy-wash text-state-released",
  CANCELLED: "bg-paper-sunken text-ink-faint",
  DISPUTED: "bg-sell-wash text-state-disputed",
};

export default async function OrdersPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orders = await fetchMyOrders(supabase, user.id);

  return (
    <>
      <SiteHeader account={accountLabel(user)} active="orders" userId={user.id} />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-xl font-semibold text-ink">Orders</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Trades you&apos;re a party to, as buyer or seller.
        </p>

        {orders.length === 0 ? (
          <p className="mt-8 text-sm text-ink-muted">
            No orders yet. Open one from the{" "}
            <Link href="/market" className="text-amber underline">
              order book
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-6 space-y-2">
            {orders.map((o) => {
              const isBuyer = o.buyer_id === user.id;
              return (
                <li key={o.id}>
                  <Link
                    href={`/orders/${o.id}`}
                    className="flex items-center justify-between rounded-card border border-paper-border bg-paper-raised px-4 py-3 hover:border-ink-faint"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase " +
                          (isBuyer
                            ? "bg-buy-wash text-buy"
                            : "bg-sell-wash text-sell")
                        }
                      >
                        {isBuyer ? "Buy" : "Sell"}
                      </span>
                      <div>
                        <p className="font-amount text-sm text-ink">
                          {formatUsdt(o.amount_usdt)} USDT
                        </p>
                        <p className="font-amount text-xs text-ink-faint">
                          {formatEtb(o.amount_etb)} ETB
                        </p>
                      </div>
                    </div>
                    <span
                      className={
                        "rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                        STATE_STYLE[o.state]
                      }
                    >
                      {o.state}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
