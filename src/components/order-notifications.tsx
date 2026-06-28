"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatUsdt } from "@/lib/money";
import type { OrderState } from "@/types/domain";
import { soundEffects } from "@/lib/audio";

type Toast = {
  id: string;
  title: string;
  detail: string;
  href: string;
};

type OrderPayload = {
  id: string;
  buyer_id: string;
  seller_id: string;
  amount_usdt: string | number;
  state: OrderState;
};

const STATE_TEXT: Record<OrderState, string> = {
  CREATED: "New order opened",
  PAID: "Buyer marked the payment sent",
  RELEASED: "USDT released — trade complete",
  CANCELLED: "Order cancelled",
  DISPUTED: "Order moved to dispute",
};

/**
 * Subscribes the signed-in user to live order events and surfaces them as
 * dismissible toasts (and a browser notification when permitted). Realtime
 * enforces RLS, so only the user's own orders (as buyer or seller) are
 * delivered — no client-side filter on identity is needed.
 *
 * Mounted once globally via SiteHeader, so notifications follow the user across
 * every authenticated page.
 */
export function OrderNotifications({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = (t: Toast, state?: OrderState) => {
    setToasts((prev) => [...prev, t]);
    
    // Sound & Haptic notification
    if (state === "RELEASED") {
      soundEffects.playSuccessChime();
    } else if (state === "DISPUTED" || state === "CANCELLED") {
      soundEffects.playAlertChime();
    } else {
      soundEffects.playChatChime();
    }

    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      try {
        new Notification(t.title, { body: t.detail });
      } catch {
        // some browsers throw if not from a user gesture; ignore
      }
    }
    // auto-dismiss
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== t.id));
    }, 9000);
  };

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }

    const channel = supabase
      .channel(`orders-notify-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload) => {
          const o = payload.new as OrderPayload;
          const iAmBuyer = o.buyer_id === userId;
          push(
            {
              id: `${o.id}-created-${Date.now()}`,
              title: "New order opened",
              detail: `${formatUsdt(o.amount_usdt)} USDT — you are ${
                iAmBuyer ? "buying" : "selling"
              }`,
              href: `/orders/${o.id}`,
            },
            o.state,
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders" },
        (payload) => {
          const o = payload.new as OrderPayload;
          const prev = payload.old as Partial<OrderPayload>;
          // Only notify when the lifecycle state actually changed.
          if (prev.state === o.state) return;
          push(
            {
              id: `${o.id}-${o.state}-${Date.now()}`,
              title: STATE_TEXT[o.state] ?? "Order updated",
              detail: `${formatUsdt(o.amount_usdt)} USDT`,
              href: `/orders/${o.id}`,
            },
            o.state,
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId]);


  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 top-16 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => {
            router.push(t.href);
            setToasts((prev) => prev.filter((x) => x.id !== t.id));
          }}
          className="w-full rounded-card border border-amber/40 bg-paper-raised p-3 text-left shadow-lg transition-colors hover:border-amber"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber" />
            {t.title}
          </p>
          <p className="mt-0.5 pl-4 font-amount text-xs text-ink-muted">
            {t.detail}
          </p>
        </button>
      ))}
    </div>
  );
}
