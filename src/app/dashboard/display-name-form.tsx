"use client";

import { useActionState, useEffect, useState } from "react";
import {
  setDisplayNameAction,
  checkDisplayNameAction,
  type DisplayNameState,
} from "./actions";

/**
 * Set a public marketplace nickname (migration 0062) — Binance-style. The name is
 * cosmetic: it's shown to other traders in the order book and on the order screen,
 * but the real (KYC) name is what a counterparty actually pays to/from, so this
 * never touches payment safety. Only KYC-verified accounts can set one. The SQL
 * RPC is the authoritative validator (uniqueness, reserved words, format); this
 * form just gives live ✓/✗ feedback as you type.
 */
const HINTS: Record<string, { text: string; ok: boolean }> = {
  ok: { text: "Available", ok: true },
  short: { text: "At least 3 characters", ok: false },
  long: { text: "20 characters or fewer", ok: false },
  chars: { text: "Letters, numbers, spaces and . _ - only", ok: false },
  reserved: { text: "That name isn't allowed", ok: false },
  taken: { text: "Already taken", ok: false },
};

export function DisplayNameForm({
  current,
  verified,
  legalName,
}: {
  current: string | null;
  verified: boolean;
  legalName: string;
}) {
  const [state, formAction, pending] = useActionState<DisplayNameState, FormData>(
    setDisplayNameAction,
    {},
  );
  const [value, setValue] = useState(current ?? "");
  const [status, setStatus] = useState<string>("");
  const [checking, setChecking] = useState(false);

  // After a successful save/clear, sync the input to what was actually stored.
  useEffect(() => {
    if (state.ok !== undefined) setValue(state.value ?? "");
  }, [state]);

  // Debounced live availability/format check. Skip when empty or unchanged
  // (unchanged === the name you already own, so there's nothing to check).
  useEffect(() => {
    const v = value.trim();
    if (v === "" || v === (current ?? "").trim()) {
      setStatus("");
      setChecking(false);
      return;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      const res = await checkDisplayNameAction(v);
      setStatus(res.status);
      setChecking(false);
    }, 400);
    return () => clearTimeout(t);
  }, [value, current]);

  if (!verified) {
    return (
      <section className="rounded-card border border-paper-border bg-paper-raised p-5">
        <h2 className="text-sm font-medium text-ink">Display name</h2>
        <p className="mt-1 text-xs text-ink-faint">
          A public nickname other traders see in the market — like your Binance P2P
          name. Your real name stays private and is used only for payment and
          verification.
        </p>
        <div className="mt-3 rounded-md border border-amber/40 bg-amber-wash px-3 py-2.5 text-xs text-ink-soft">
          Verify your identity first to choose a display name.{" "}
          <a href="/verify" className="font-medium text-amber hover:text-amber-soft">
            Verify now →
          </a>
        </div>
      </section>
    );
  }

  const trimmed = value.trim();
  const unchanged = trimmed === (current ?? "").trim();
  const canSave = trimmed !== "" && status === "ok" && !unchanged && !pending;
  const hint = status && status !== "empty" ? HINTS[status] : undefined;

  return (
    <section className="rounded-card border border-paper-border bg-paper-raised p-5">
      <h2 className="text-sm font-medium text-ink">Display name</h2>
      <p className="mt-1 text-xs text-ink-faint">
        A public nickname other traders see in the market. Your real name
        {legalName ? ` (${legalName})` : ""} stays private and is used only for
        payment and verification.
      </p>

      <p className="mt-3 text-xs text-ink-muted">
        Traders currently see you as{" "}
        <span className="font-semibold text-ink">
          {current?.trim() || legalName || "your real name"}
        </span>
      </p>

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

      <form action={formAction} className="mt-4">
        <label htmlFor="display_name" className="block text-xs text-ink-muted">
          Nickname (3–20 characters)
        </label>
        <div className="mt-1 flex items-start gap-2">
          <div className="flex-1">
            <input
              id="display_name"
              name="display_name"
              type="text"
              autoComplete="off"
              maxLength={20}
              placeholder="e.g. AddisTrader"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full rounded-md border border-paper-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-amber focus:outline-none"
            />
            <div className="mt-1 h-4 text-xs">
              {checking && <span className="text-ink-faint">Checking…</span>}
              {!checking && hint && (
                <span className={hint.ok ? "text-buy" : "text-sell"}>
                  {hint.ok ? "✓ " : "✗ "}
                  {hint.text}
                </span>
              )}
              {!checking && !hint && unchanged && trimmed !== "" && (
                <span className="text-ink-faint">This is your current name</span>
              )}
            </div>
          </div>
          <button
            type="submit"
            disabled={!canSave}
            className="rounded-md bg-amber px-4 py-2 text-sm font-semibold text-paper hover:bg-amber-soft disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      {current && (
        <form action={formAction} className="mt-1">
          <input type="hidden" name="display_name" value="" />
          <button
            type="submit"
            disabled={pending}
            className="text-xs text-ink-faint underline-offset-2 hover:text-sell hover:underline disabled:opacity-50"
          >
            Remove display name (show my real name)
          </button>
        </form>
      )}
    </section>
  );
}
