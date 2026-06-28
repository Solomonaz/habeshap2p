"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchMessages,
  sendMessage,
  uploadProof,
  signedProofUrl,
  type MessageRow,
} from "@/lib/messages";
import { soundEffects } from "@/lib/audio";

const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB

export function OrderChat({
  orderId,
  currentUserId,
  initialMessages,
  counterpartyLabel,
}: {
  orderId: string;
  currentUserId: string;
  initialMessages: MessageRow[];
  counterpartyLabel: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(soundEffects.isEnabled());
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundEffects.setEnabled(next);
    if (next) soundEffects.playChatChime();
  };

  // Merge a row in by id, keeping the list ordered and deduped (realtime can
  // echo a row we already optimistically hold from our own insert).
  const upsert = useCallback(
    (row: MessageRow) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === row.id)) return prev;
        if (row.sender_id !== currentUserId) {
          soundEffects.playChatChime();
        }
        return [...prev, row].sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        );
      });
    },
    [currentUserId],
  );

  // Live updates: any new message on this order arrives via Realtime (RLS
  // guarantees we only receive rows for orders we're a party to).
  useEffect(() => {
    const channel = supabase
      .channel(`messages-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `order_id=eq.${orderId}`,
        },
        (payload) => upsert(payload.new as MessageRow),
      )
      .subscribe();
    // Refetch once on mount in case messages landed between SSR and subscribe.
    void fetchMessages(supabase, orderId).then((rows) =>
      setMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const r of rows) byId.set(r.id, r);
        return [...byId.values()].sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        );
      }),
    );
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, orderId, upsert]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setError(null);
    setSending(true);
    const body = text.trim();
    setText("");
    try {
      await sendMessage(supabase, { orderId, senderId: currentUserId, body });
    } catch (err) {
      setText(body);
      setError(err instanceof Error ? err.message : "failed to send");
    } finally {
      setSending(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("proof must be an image");
      return;
    }
    if (file.size > MAX_PROOF_BYTES) {
      setError("image too large (max 5 MB)");
      return;
    }
    setSending(true);
    try {
      const path = await uploadProof(supabase, orderId, file);
      await sendMessage(supabase, {
        orderId,
        senderId: currentUserId,
        imagePath: path,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-4 rounded-card border border-paper-border bg-paper-raised">
      <header className="flex items-center justify-between border-b border-paper-border px-4 py-3">
        <h2 className="text-sm font-medium text-ink">Chat</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-faint">with {counterpartyLabel}</span>
          <button
            type="button"
            onClick={toggleSound}
            title={soundEnabled ? "Mute audio chimes" : "Enable audio chimes"}
            className="text-xs text-ink-muted hover:text-ink transition-colors px-1 py-0.5 rounded"
          >
            {soundEnabled ? "🔔 Sound ON" : "🔕 Sound OFF"}
          </button>
        </div>
      </header>


      <div className="h-72 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-faint">
            No messages yet. Share payment details and proof here — this log is
            permanent and is what an admin reviews in a dispute.
          </p>
        ) : (
          messages.map((m) => (
            <ChatBubble
              key={m.id}
              message={m}
              mine={m.sender_id === currentUserId}
              supabase={supabase}
            />
          ))
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
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="hidden"
          id="proof-upload"
        />
        <label
          htmlFor="proof-upload"
          title="Attach payment proof"
          className="cursor-pointer rounded-md border border-paper-border px-3 py-2 text-sm text-ink-soft hover:bg-paper-sunken"
        >
          📎
        </label>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message…"
          className="flex-1 rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="rounded-md bg-amber px-4 py-2 text-sm font-semibold text-paper hover:bg-amber-soft disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}

function ChatBubble({
  message,
  mine,
  supabase,
}: {
  message: MessageRow;
  mine: boolean;
  supabase: ReturnType<typeof createClient>;
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!message.image_url) return;
    let active = true;
    void signedProofUrl(supabase, message.image_url).then((url) => {
      if (active) setImgUrl(url);
    });
    return () => {
      active = false;
    };
  }, [supabase, message.image_url]);

  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          "max-w-[78%] rounded-card px-3 py-2 text-sm " +
          (mine
            ? "bg-amber/15 text-ink"
            : "bg-paper-sunken text-ink-soft")
        }
      >
        {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
        {message.image_url &&
          (imgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <a href={imgUrl} target="_blank" rel="noopener noreferrer">
              <img
                src={imgUrl}
                alt="Payment proof"
                className="mt-1 max-h-56 rounded-md border border-paper-border"
              />
            </a>
          ) : (
            <p className="text-xs text-ink-faint">Loading proof…</p>
          ))}
        <p className="mt-1 text-right text-[10px] text-ink-faint">{time}</p>
      </div>
    </div>
  );
}
