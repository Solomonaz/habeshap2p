"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { soundEffects } from "@/lib/audio";
import { replySupportAction } from "../actions";

type Row = Database["public"]["Tables"]["support_messages"]["Row"];

/**
 * The admin's side of a trader's support thread: the team's replies sit on the
 * right, the trader's messages on the left. New messages stream in over Realtime
 * (admins can read every thread under RLS).
 */
export function AdminSupportThread({
  userId,
  initialMessages,
}: {
  userId: string;
  initialMessages: Row[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<Row[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const upsert = useCallback((row: Row) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === row.id)) return prev;
      if (!row.from_admin) soundEffects.playChatChime();
      return [...prev, row].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );
    });
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`admin-support-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "support_messages",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => upsert(payload.new as Row),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, userId, upsert]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    setText("");
    const fd = new FormData();
    fd.set("userId", userId);
    fd.set("body", body);
    const res = await replySupportAction({}, fd);
    if (res.error) {
      setText(body);
      setError(res.error);
    }
    setSending(false);
  }

  return (
    <section className="mt-5 rounded-card border border-paper-border bg-paper-raised">
      <div className="h-[26rem] space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="flex h-full items-center justify-center text-sm text-ink-faint">
            No messages in this thread yet.
          </p>
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="px-4 pb-2 text-xs text-sell" role="alert">
          {error}
        </p>
      )}

      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 border-t border-paper-border px-3 py-3"
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          placeholder="Reply to this trader…"
          className="flex-1 rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="rounded-md bg-amber px-4 py-2 text-sm font-semibold text-paper hover:bg-amber-soft disabled:opacity-50"
        >
          {sending ? "Sending…" : "Reply"}
        </button>
      </form>
    </section>
  );
}

function Bubble({ message }: { message: Row }) {
  const mine = message.from_admin; // the team's replies sit on the right
  const time = new Date(message.created_at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div className="max-w-[80%]">
        {!mine && (
          <p className="mb-0.5 ml-1 text-[11px] font-semibold text-ink-muted">
            Trader
          </p>
        )}
        <div
          className={
            "rounded-card px-3 py-2 text-sm " +
            (mine ? "bg-amber/15 text-ink" : "bg-paper-sunken text-ink-soft")
          }
        >
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
          <p className="mt-1 text-right text-[10px] text-ink-faint">{time}</p>
        </div>
      </div>
    </div>
  );
}
