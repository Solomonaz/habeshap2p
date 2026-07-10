"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { fetchActiveAds, type AdWithPoster } from "@/lib/ads";
import { formatUsdt } from "@/lib/money";
import { formatEtb, formatRate } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_COLOR } from "@/lib/labels";
import { traderName, traderInitialFrom, traderColor } from "@/lib/handle";
import { isOnline } from "@/lib/presence";
import { PAYMENT_METHODS, type PaymentMethod } from "@/types/domain";

// Tabs are from the TAKER's perspective (like Binance P2P):
//   "buy"  → ads where the advertiser SELLS USDT (you buy)  → green
//   "sell" → ads where the advertiser BUYS USDT  (you sell) → red
type Tab = "buy" | "sell";
type MethodFilter = "ALL" | PaymentMethod;

export function OrderBook({
  initialAds,
  currentUserId,
  paymentWindowMinutes,
}: {
  initialAds: AdWithPoster[];
  currentUserId: string;
  paymentWindowMinutes: number;
}) {
  const [ads, setAds] = useState<AdWithPoster[]>(initialAds);
  const [tab, setTab] = useState<Tab>("buy");
  const [method, setMethod] = useState<MethodFilter>("ALL");
  const [amount, setAmount] = useState("");
  const [live, setLive] = useState(false);
  // Each listed trader's last_seen, kept fresh independently of the ads stream
  // (presence changes don't touch the ads table). Seeded from the SSR snapshot.
  const [presence, setPresence] = useState<Record<string, string | null>>(() => {
    const m: Record<string, string | null> = {};
    for (const a of initialAds) if (a.poster) m[a.user_id] = a.poster.last_seen_at ?? null;
    return m;
  });

  const supabase = useMemo(() => createClient(), []);
  // Latest ads for the presence poll, without re-creating its interval each change.
  const adsRef = useRef(ads);
  adsRef.current = ads;

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

  // Live online/offline: re-read every listed trader's last_seen every 15s. Each
  // poll writes a fresh object so the card re-renders and a trader who stopped
  // heartbeating flips to "offline" within the presence window, in real time.
  useEffect(() => {
    let active = true;
    const poll = async () => {
      const ids = [...new Set(adsRef.current.map((a) => a.user_id))];
      if (ids.length === 0) {
        if (active) setPresence({});
        return;
      }
      const { data } = await supabase
        .from("public_profiles")
        .select("id, last_seen_at")
        .in("id", ids);
      if (!active) return;
      const next: Record<string, string | null> = {};
      for (const row of data ?? []) next[row.id] = row.last_seen_at ?? null;
      setPresence(next);
    };
    void poll();
    const timer = setInterval(poll, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [supabase]);

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
        // For SELL ads, filter against the seller's LIVE max (capped by balance).
        const effMax = Number(a.capacity?.effectiveMaxEtb ?? a.max_etb);
        if (amt < Number(a.min_etb) || amt > effMax) return false;
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
        <div className="inline-flex rounded-xl border border-paper-border bg-paper-sunken/70 p-1">
          <TabButton
            tab="buy"
            active={tab === "buy"}
            onClick={() => setTab("buy")}
          >
            Buy
          </TabButton>
          <TabButton
            tab="sell"
            active={tab === "sell"}
            onClick={() => setTab("sell")}
          >
            Sell
          </TabButton>
        </div>
        <span className="flex items-center gap-1.5 rounded-lg border border-paper-border bg-paper-sunken/60 px-3 py-2 text-sm font-medium text-ink">
          ETB
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" />
          </svg>
        </span>
      </div>

      {/* ── Token + filters ── */}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-b border-paper-border pb-5">
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
          className="w-36 rounded-lg border border-paper-border bg-paper-sunken/60 px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus:border-amber focus:outline-none"
        />
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as MethodFilter)}
          className="rounded-lg border border-paper-border bg-paper-sunken/60 px-3 py-2 text-sm text-ink transition-colors focus:border-amber focus:outline-none"
        >
          <option value="ALL">All payments</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
        <span
          className="ml-auto flex items-center gap-1.5 rounded-full border border-paper-border bg-paper-sunken/50 px-2.5 py-1 text-xs font-medium text-ink-soft"
          aria-live="polite"
        >
          <span className="relative flex h-2 w-2" aria-hidden>
            {live && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-buy opacity-60" />
            )}
            <span
              className={
                "relative inline-flex h-2 w-2 rounded-full " +
                (live ? "bg-buy" : "bg-ink-faint")
              }
            />
          </span>
          {live ? "Live" : "Connecting…"}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="mt-12 flex flex-col items-center gap-3 py-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-paper-border bg-paper-sunken/60 text-ink-faint">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M16 16l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <p className="text-sm text-ink-muted">
            No {tab === "buy" ? "sellers" : "buyers"} match your filters.
          </p>
          <Link href="/market/new" className="text-sm font-medium text-amber hover:text-amber-soft">
            Post an ad →
          </Link>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {visible.map((ad) => (
            <AdCard
              key={ad.id}
              ad={ad}
              tab={tab}
              paymentWindowMinutes={paymentWindowMinutes}
              lastSeen={presence[ad.user_id] ?? ad.poster?.last_seen_at ?? null}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TabButton({
  tab,
  active,
  onClick,
  children,
}: {
  tab: Tab;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeTone =
    tab === "buy" ? "bg-buy text-paper shadow-sm" : "bg-sell text-white shadow-sm";
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-lg px-6 py-1.5 text-sm font-semibold transition-all duration-150 " +
        (active ? activeTone : "text-ink-muted hover:text-ink")
      }
    >
      {children}
    </button>
  );
}

function AdCard({
  ad,
  tab,
  paymentWindowMinutes,
  lastSeen,
}: {
  ad: AdWithPoster;
  tab: Tab;
  paymentWindowMinutes: number;
  lastSeen: string | null;
}) {
  const takerBuys = tab === "buy";
  const name = traderName(ad.poster?.full_name, ad.user_id);
  const verified = ad.poster?.is_verified ?? false;
  const online = isOnline(lastSeen);
  // Order ceiling derived from the ETB limits. For a SELL ad we use the seller's
  // LIVE max (capped by their current balance, migration 0059) so buyers never see
  // a limit the seller can't fund; it only ever exposes the ad's own liquidity.
  const rate = Number(ad.rate_etb);
  const maxEtb = ad.capacity?.effectiveMaxEtb ?? ad.max_etb;
  const minUsdt = rate > 0 ? (Number(ad.min_etb) / rate).toFixed(2) : "0";
  const maxUsdt = rate > 0 ? (Number(maxEtb) / rate).toFixed(2) : "0";

  return (
    <li className="group rounded-xl border border-paper-border bg-paper-sunken/30 p-5 transition-all duration-150 hover:border-ink-faint/50 hover:bg-paper-sunken/60">
      {/* Trader row */}
      <div className="flex items-center gap-2.5">
        <span
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-paper-raised"
          style={{ backgroundColor: traderColor(ad.user_id) }}
        >
          {traderInitialFrom(ad.poster?.full_name, ad.user_id)}
          {/* Live status dot on the avatar corner. */}
          <span
            aria-hidden
            className={
              "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-paper-raised " +
              (online ? "bg-buy" : "bg-ink-faint")
            }
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-ink">
              {name}
            </span>
            {verified && (
              <span
                className="flex shrink-0 items-center text-buy"
                title="Identity verified"
                aria-label="Identity verified"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 2l2.4 1.8 3 .1 1 2.8 2.4 1.7-.9 2.9.9 2.9-2.4 1.7-1 2.8-3 .1L12 22l-2.4-1.8-3-.1-1-2.8L3.2 15l.9-2.9-.9-2.9 2.4-1.7 1-2.8 3-.1L12 2z" />
                  <path d="M9 12l2 2 4-4" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
            {ad.poster?.is_merchant && (
              <span
                className="flex items-center gap-1 rounded-full bg-amber-wash px-1.5 py-0.5 text-[10px] font-semibold text-amber"
                title="Verified merchant"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="#fcd535" aria-hidden>
                  <path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z" />
                </svg>
                Merchant
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-faint">
            {ad.poster
              ? `${ad.poster.completed_trades} trades · ${ad.poster.completion_rate}% completion`
              : "New trader"}
          </p>
        </div>

        {/* Real-time online/offline status — critical so the taker knows whether
            the counterparty is around to respond. */}
        <span
          className={
            "flex shrink-0 items-center gap-1.5 self-start rounded-full px-2 py-0.5 text-[11px] font-medium " +
            (online
              ? "bg-buy/15 text-buy"
              : "bg-paper-sunken text-ink-muted")
          }
        >
          <span
            aria-hidden
            className={
              "h-1.5 w-1.5 rounded-full " +
              (online ? "animate-pulse bg-buy" : "bg-ink-faint")
            }
          />
          {online ? "Online" : "Offline"}
        </span>
      </div>

      {/* Price + button row */}
      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-baseline gap-1.5">
            <span
              className={
                "font-amount text-[28px] font-bold leading-none " +
                (takerBuys ? "text-buy" : "text-sell")
              }
            >
              {formatRate(ad.rate_etb)}
            </span>
            <span className="text-xs font-medium text-ink-muted">ETB</span>
          </p>
          <div className="mt-3 space-y-1">
            <p className="text-xs text-ink-faint">
              <span className="text-ink-muted">Limit</span>{" "}
              <span className="font-amount text-ink-soft">
                {formatEtb(ad.min_etb)} – {formatEtb(maxEtb)} ETB
              </span>
            </p>
            <p className="text-xs text-ink-faint">
              <span className="text-ink-muted">Quantity</span>{" "}
              <span className="font-amount text-ink-soft">
                {formatUsdt(minUsdt)} – {formatUsdt(maxUsdt)} USDT
              </span>
            </p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
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

        <div className="flex shrink-0 flex-col items-end gap-2.5">
          <span className="flex items-center gap-1 text-xs text-ink-faint">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
              <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" />
            </svg>
            {paymentWindowMinutes} min window
          </span>
          <Link
            href={`/market/trade/${ad.id}`}
            className={
              "inline-flex items-center gap-1.5 rounded-lg px-7 py-2.5 text-sm font-semibold text-paper shadow-sm transition-all duration-150 hover:brightness-105 active:translate-y-px " +
              (takerBuys ? "bg-buy" : "bg-sell")
            }
          >
            {takerBuys ? "Buy" : "Sell"} USDT
          </Link>
        </div>
      </div>
    </li>
  );
}
