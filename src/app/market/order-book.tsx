"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { fetchActiveAds, type AdWithPoster } from "@/lib/ads";
import { formatUsdt } from "@/lib/money";
import { formatEtb, formatRate } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_COLOR } from "@/lib/labels";
import { traderHandle, traderInitial, traderColor } from "@/lib/handle";
import { PAYMENT_METHODS, type PaymentMethod } from "@/types/domain";

// Tabs are from the TAKER's perspective (like Binance P2P):
//   "buy"  → ads where the advertiser SELLS USDT (you buy)  → green
//   "sell" → ads where the advertiser BUYS USDT  (you sell) → red
type Tab = "buy" | "sell";
type MethodFilter = "ALL" | PaymentMethod;

export function OrderBook({
  initialAds,
  currentUserId,
}: {
  initialAds: AdWithPoster[];
  currentUserId: string;
}) {
  const [ads, setAds] = useState<AdWithPoster[]>(initialAds);
  const [tab, setTab] = useState<Tab>("buy");
  const [method, setMethod] = useState<MethodFilter>("ALL");
  const [amount, setAmount] = useState("");
  const [live, setLive] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  const refetch = useCallback(async () => {
    try {
      setAds(await fetchActiveAds(supabase));
    } catch {
      // transient; the next realtime event or manual refresh will recover
    }
  }, [supabase]);

  useEffect(() => {
    const channel = supabase
      .channel("ads-order-book")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ads" },
        () => {
          void refetch();
        },
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, refetch]);

  const wantSide = tab === "buy" ? "SELL" : "BUY";

  const visible = useMemo(() => {
    const amt = amount.trim() === "" ? null : Number(amount);
    const filtered = ads.filter((a) => {
      // You can't trade with yourself — hide your own ads (RLS returns them
      // because you own them, so we exclude here).
      if (a.user_id === currentUserId) return false;
      if (a.side !== wantSide) return false;
      if (method !== "ALL" && !a.payment_methods.includes(method)) return false;
      if (amt != null && Number.isFinite(amt)) {
        if (amt < Number(a.min_etb) || amt > Number(a.max_etb)) return false;
      }
      return true;
    });
    // Buying: cheapest rate first. Selling: best (highest) rate first.
    return [...filtered].sort((a, b) => {
      const diff = Number(a.rate_etb) - Number(b.rate_etb);
      return tab === "buy" ? diff : -diff;
    });
  }, [ads, wantSide, method, amount, tab, currentUserId]);

  return (
    <div>
      {/* ── Tabs + fiat selector ── */}
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-full bg-paper-sunken p-1">
          <TabButton active={tab === "buy"} onClick={() => setTab("buy")}>
            Buy
          </TabButton>
          <TabButton active={tab === "sell"} onClick={() => setTab("sell")}>
            Sell
          </TabButton>
        </div>
        <span className="flex items-center gap-1.5 rounded-md border border-paper-border bg-paper-raised px-3 py-1.5 text-sm text-ink">
          ETB
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" />
          </svg>
        </span>
      </div>

      {/* ── Token + filters ── */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-b border-paper-border pb-4">
        <span className="flex items-center gap-2 font-semibold text-ink">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-buy text-[11px] font-bold text-paper">
            ₮
          </span>
          USDT
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount (ETB)"
          className="w-36 rounded-md border border-paper-border bg-paper-raised px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
        />
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as MethodFilter)}
          className="rounded-md border border-paper-border bg-paper-raised px-3 py-1.5 text-sm text-ink focus:border-amber focus:outline-none"
        >
          <option value="ALL">All payments</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
        <span
          className="ml-auto flex items-center gap-1.5 text-xs text-ink-faint"
          aria-live="polite"
        >
          <span
            className={
              "inline-block h-2 w-2 rounded-full " +
              (live ? "bg-buy" : "bg-ink-faint")
            }
            aria-hidden
          />
          {live ? "Live" : "Connecting…"}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="mt-10 text-center text-sm text-ink-muted">
          No {tab === "buy" ? "sellers" : "buyers"} match.{" "}
          <Link href="/market/new" className="text-amber underline">
            Post an ad
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-paper-border">
          {visible.map((ad) => (
            <AdCard key={ad.id} ad={ad} tab={tab} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full px-5 py-1.5 text-sm font-semibold transition-colors " +
        (active ? "bg-ink text-paper" : "text-ink-muted hover:text-ink")
      }
    >
      {children}
    </button>
  );
}

function AdCard({ ad, tab }: { ad: AdWithPoster; tab: Tab }) {
  const takerBuys = tab === "buy";
  const handle = traderHandle(ad.user_id);
  // Order ceiling in USDT, derived from the public ETB limits — no wallet leak.
  const rate = Number(ad.rate_etb);
  const minUsdt = rate > 0 ? (Number(ad.min_etb) / rate).toFixed(2) : "0";
  const maxUsdt = rate > 0 ? (Number(ad.max_etb) / rate).toFixed(2) : "0";

  return (
    <li className="py-5">
      {/* Trader row */}
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white"
          style={{ backgroundColor: traderColor(ad.user_id) }}
        >
          {traderInitial(ad.user_id)}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-ink">
              {handle}
            </span>
            {ad.poster?.is_merchant && (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="#fcd535"
                aria-label="Merchant"
              >
                <path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z" />
              </svg>
            )}
          </div>
          <p className="text-xs text-ink-faint">
            {ad.poster
              ? `Trades ${ad.poster.completed_trades} (${ad.poster.completion_rate}%)`
              : "New trader"}
          </p>
        </div>
      </div>

      {/* Price + button row */}
      <div className="mt-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-baseline gap-1.5">
            <span className="text-xs text-ink-muted">ETB</span>
            <span
              className={
                "font-amount text-2xl font-semibold " +
                (takerBuys ? "text-buy" : "text-sell")
              }
            >
              {formatRate(ad.rate_etb)}
            </span>
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            <span className="text-ink-muted">Limit</span>{" "}
            <span className="font-amount">
              {formatEtb(ad.min_etb)} – {formatEtb(ad.max_etb)} ETB
            </span>
          </p>
          <p className="text-xs text-ink-faint">
            <span className="text-ink-muted">Quantity</span>{" "}
            <span className="font-amount">
              {formatUsdt(minUsdt)} – {formatUsdt(maxUsdt)} USDT
            </span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {ad.payment_methods.map((m) => (
              <span
                key={m}
                className="flex items-center gap-1.5 text-xs text-ink-soft"
              >
                <span
                  className="inline-block h-3 w-0.5 rounded"
                  style={{ backgroundColor: PAYMENT_METHOD_COLOR[m] }}
                  aria-hidden
                />
                {PAYMENT_METHOD_LABELS[m]}
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="flex items-center gap-1 text-xs text-ink-faint">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
              <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" />
            </svg>
            15 minutes
          </span>
          <Link
            href={`/market/trade/${ad.id}`}
            className={
              "inline-block rounded-md px-6 py-2 text-sm font-semibold text-paper transition-opacity hover:opacity-90 " +
              (takerBuys ? "bg-buy" : "bg-sell")
            }
          >
            {takerBuys ? "Buy" : "Sell"}
          </Link>
        </div>
      </div>
    </li>
  );
}
