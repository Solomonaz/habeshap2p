"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { NotificationRow } from "@/lib/notifications";
import { soundEffects } from "@/lib/audio";

/**
 * The notification center: a bell with an unread badge that opens a dropdown of
 * the user's recent notifications. Seeded with server-fetched rows, then kept
 * live over Supabase Realtime (RLS scopes the stream to the user's own rows).
 * Clicking an item marks it read and navigates; "Mark all read" clears the badge.
 *
 * Mounted once in the header (and the admin shell), so it follows the user.
 */
export function NotificationBell({
  userId,
  initial,
}: {
  userId: string;
  initial: NotificationRow[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[]>(initial);
  const [open, setOpen] = useState(false);

  const unread = items.filter((n) => !n.read_at).length;

  // Live stream of new notifications for this user.
  useEffect(() => {
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as NotificationRow;
          setItems((prev) => {
            if (prev.some((p) => p.id === row.id)) return prev;
            
            // Sound and haptic vibration for all incoming system/admin notifications.
            // Money & order events get the long, ring-3×-plus-3s-buzz alert so they
            // aren't missed on an idle phone; only minor events keep the soft chime.
            const type = row.type || "";
            if (
              type.includes("credited") ||
              type.includes("approved") ||
              type.includes("reinstated") ||
              type.includes("confirmed") ||
              type.includes("released") ||
              type.includes("sent")
            ) {
              soundEffects.playSuccessChime();
            } else if (
              type.includes("unmatched") ||
              type.includes("rejected") ||
              type.includes("failed") ||
              type.includes("banned") ||
              type.includes("frozen") ||
              type.includes("paid") ||
              type.includes("dispute")
            ) {
              soundEffects.playAlertChime();
            } else {
              soundEffects.playChatChime();
            }

            return [row, ...prev].slice(0, 40);
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId]);


  async function markAllRead() {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    await supabase.rpc("mark_notifications_read", { p_ids: null });
  }

  async function onItemClick(n: NotificationRow) {
    if (!n.read_at) {
      const now = new Date().toISOString();
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: now } : x)),
      );
      await supabase.rpc("mark_notifications_read", { p_ids: [n.id] });
    }
    setOpen(false);
    if (n.href) router.push(n.href);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-paper-sunken/60 hover:text-ink"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
          <path d="M10.5 20a2 2 0 0 0 3 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-sell px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click-away backdrop */}
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-paper-border bg-paper-raised shadow-2xl">
            <div className="flex items-center justify-between border-b border-paper-border px-4 py-2.5">
              <span className="text-sm font-semibold text-ink">Notifications</span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-xs font-medium text-amber hover:text-amber-soft"
                >
                  Mark all read
                </button>
              )}
            </div>

            <ul className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <li className="px-4 py-10 text-center text-sm text-ink-faint">
                  No notifications yet.
                </li>
              ) : (
                items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onItemClick(n)}
                      className={
                        "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-sunken/60 " +
                        (n.read_at ? "" : "bg-amber-wash/40")
                      }
                    >
                      <span
                        aria-hidden
                        className={
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full " +
                          dotColor(n.type, !!n.read_at)
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink">
                          {n.title}
                        </span>
                        {n.body && (
                          <span className="mt-0.5 block text-xs text-ink-soft">
                            {n.body}
                          </span>
                        )}
                        <span className="mt-1 block text-[11px] text-ink-faint">
                          {timeAgo(n.created_at)}
                          {n.audience === "admin" && (
                            <span className="ml-1.5 rounded bg-paper-sunken px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
                              admin
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

/** Colour the leading dot by event family; muted once read. */
function dotColor(type: string, read: boolean): string {
  if (read) return "bg-ink-faint";
  if (type.startsWith("withdrawal") || type.startsWith("deposit")) return "bg-amber";
  if (type.startsWith("dispute") || type.includes("frozen") || type.includes("ban"))
    return "bg-sell";
  if (type.includes("released") || type.includes("approved") || type.includes("confirmed"))
    return "bg-buy";
  return "bg-state-locked";
}

/** Compact relative time: 12s · 5m · 3h · 2d · then a date. */
function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
