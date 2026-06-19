"use client";

import { useEffect, useState } from "react";

/**
 * "Continue with Telegram" — a custom button styled to match the Google one
 * (instead of Telegram's mismatched iframe widget) so the social options look
 * consistent.
 *
 * It loads Telegram's official widget script once and, on click, opens the
 * native Telegram auth popup via `window.Telegram.Login.auth`. That popup needs
 * the NUMERIC bot id (the integer before the colon in the BotFather token), not
 * the @username — so we take `botId`. On success Telegram hands back a signed
 * payload, which we forward to our existing /auth/telegram GET route as query
 * params (the route re-verifies the HMAC server-side before minting a session).
 *
 * Telegram only accepts the popup on the exact domain registered with the bot
 * via @BotFather (/setdomain).
 */
type TelegramAuthResult = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

declare global {
  interface Window {
    Telegram?: {
      Login?: {
        auth: (
          options: { bot_id: string; request_access?: string; lang?: string },
          callback: (data: TelegramAuthResult | false) => void,
        ) => void;
      };
    };
  }
}

export function TelegramLoginButton({ botId }: { botId?: string }) {
  const [loading, setLoading] = useState(false);

  // Load the widget script once so window.Telegram.Login.auth is available.
  useEffect(() => {
    if (window.Telegram?.Login) return;
    if (document.getElementById("telegram-widget-script")) return;
    const script = document.createElement("script");
    script.id = "telegram-widget-script";
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  function onClick() {
    if (!botId || !window.Telegram?.Login) {
      window.location.href = "/login?error=telegram_unconfigured";
      return;
    }
    setLoading(true);
    window.Telegram.Login.auth(
      { bot_id: botId, request_access: "write" },
      (data) => {
        if (!data) {
          // User closed/cancelled the popup.
          setLoading(false);
          window.location.href = "/login?error=telegram";
          return;
        }
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(data)) {
          if (v != null) params.set(k, String(v));
        }
        window.location.href = `/auth/telegram?${params.toString()}`;
      },
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex w-full items-center justify-center gap-3 rounded-lg border border-paper-border bg-paper-sunken/60 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-ink-faint hover:bg-paper-sunken disabled:opacity-50"
    >
      <TelegramLogo />
      {loading ? "Connecting…" : "Continue with Telegram"}
    </button>
  );
}

function TelegramLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#229ED9" />
      <path
        fill="#fff"
        d="M5.5 11.8 16.9 7.4c.53-.19 1 .13.82.93l-1.94 9.16c-.13.63-.51.78-1.03.49l-2.84-2.1-1.37 1.32c-.15.15-.28.28-.57.28l.2-2.9 5.27-4.76c.23-.2-.05-.32-.35-.12l-6.51 4.1-2.8-.88c-.61-.19-.62-.61.13-.9Z"
      />
    </svg>
  );
}
