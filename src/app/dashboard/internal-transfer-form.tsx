"use client";

import { useActionState, useEffect, useState } from "react";
import { formatUsdt } from "@/lib/money";
import {
  internalTransferAction,
  lookupTransferRecipientAction,
  type TransferState,
} from "./actions";

/**
 * Send & receive USDT by HabeshaP2P ID — a free, instant, off-chain transfer
 * between accounts (no gas, no fee). The user's own ID is shown to share for
 * receiving; the send form resolves the recipient's name live so you can confirm
 * who you're paying before it goes through. All checks are re-enforced server-side.
 */
export function InternalTransferForm({
  available,
  myPublicId,
}: {
  available: string;
  myPublicId: string;
}) {
  const [state, formAction, pending] = useActionState<TransferState, FormData>(
    internalTransferAction,
    {},
  );
  const [copied, setCopied] = useState(false);
  const [recipientId, setRecipientId] = useState("");
  const [amount, setAmount] = useState("");
  const [lookup, setLookup] = useState<{ name?: string; error?: string } | null>(
    null,
  );
  const [checking, setChecking] = useState(false);

  // Debounced recipient lookup so the sender sees the name before sending.
  useEffect(() => {
    const digits = recipientId.replace(/[^0-9]/g, "");
    if (digits.length < 4) {
      setLookup(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      const res = await lookupTransferRecipientAction(recipientId);
      setLookup(res);
      setChecking(false);
    }, 400);
    return () => clearTimeout(t);
  }, [recipientId]);

  const amtNum = Number(amount);
  const canSend =
    !!lookup?.name && Number.isFinite(amtNum) && amtNum > 0 && !pending;

  function copyId() {
    void navigator.clipboard?.writeText(myPublicId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <section className="mt-4 rounded-card border border-paper-border bg-paper-raised p-5">
      <h2 className="text-sm font-medium text-ink">Send &amp; receive by ID</h2>
      <p className="mt-1 text-xs text-ink-faint">
        Transfer USDT to another HabeshaP2P account instantly — free, no network
        fee.
      </p>

      {/* Your ID — share to receive */}
      <div className="mt-3 flex items-center justify-between rounded-md bg-paper-sunken px-3 py-2.5">
        <div>
          <p className="text-xs text-ink-muted">Your HabeshaP2P ID</p>
          <p className="font-amount text-lg tracking-wide text-ink">{myPublicId}</p>
        </div>
        <button
          type="button"
          onClick={copyId}
          className="rounded-md border border-paper-border px-3 py-1.5 text-xs text-ink-soft hover:bg-paper"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>

      {state.error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-sell"
        >
          {state.error}
        </p>
      )}
      {state.ok && (
        <p
          role="status"
          className="mt-3 rounded-md border border-buy/40 bg-buy-wash px-3 py-2 text-sm text-buy"
        >
          {state.ok}
        </p>
      )}

      <form action={formAction} className="mt-4 space-y-3">
        <div>
          <label htmlFor="recipientId" className="block text-xs text-ink-muted">
            Recipient&apos;s HabeshaP2P ID
          </label>
          <input
            id="recipientId"
            name="recipientId"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 10042317"
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            className="mt-1 w-full rounded-md border border-paper-border bg-paper px-3 py-2 font-amount text-sm text-ink focus:border-amber focus:outline-none"
          />
          {checking && (
            <p className="mt-1 text-xs text-ink-faint">Looking up…</p>
          )}
          {!checking && lookup?.name && (
            <p className="mt-1 text-xs font-medium text-buy">
              → Sending to {lookup.name}
            </p>
          )}
          {!checking && lookup?.error && (
            <p className="mt-1 text-xs text-sell">{lookup.error}</p>
          )}
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="transferAmount" className="block text-xs text-ink-muted">
              Amount (USDT) · available {formatUsdt(available)}
            </label>
            <input
              id="transferAmount"
              name="amount"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-md border border-paper-border bg-paper px-3 py-2 font-amount text-sm text-ink focus:border-amber focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={!canSend}
            className="rounded-md bg-amber px-4 py-2 text-sm font-semibold text-paper hover:bg-amber-soft disabled:opacity-50"
          >
            {pending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
