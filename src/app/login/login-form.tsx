"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env";
import { TelegramLoginButton } from "@/components/telegram-login-button";
import { GoogleLoginButton } from "@/components/google-login-button";
import { PasswordInput } from "@/components/password-input";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";
  const justConfirmed = searchParams.get("confirmed") === "1";
  const justReset = searchParams.get("reset") === "1";
  const errorParam = searchParams.get("error");
  const confirmError = errorParam === "confirm";
  const unconfirmed = errorParam === "unconfirmed";
  const resetExpired = errorParam === "reset_expired";
  const telegramError = errorParam === "telegram";
  const telegramUnconfigured = errorParam === "telegram_unconfigured";
  const oauthError = errorParam === "oauth";


  const telegramBotId = publicEnv.NEXT_PUBLIC_TELEGRAM_BOT_ID;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  const inputClass =
    "w-full rounded-lg border border-paper-border bg-paper-sunken/60 px-3 py-2.5 " +
    "text-ink placeholder:text-ink-faint focus-visible:border-amber";

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Welcome back</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Sign in to your HabeshaP2P account.
      </p>

      {justConfirmed && (
        <p className="mt-5 rounded-md border border-state-released/40 bg-buy-wash px-3 py-2 text-sm text-state-released">
          Email confirmed — you can sign in now.
        </p>
      )}
      {justReset && (
        <p className="mt-5 rounded-md border border-state-released/40 bg-buy-wash px-3 py-2 text-sm text-state-released">
          Password updated successfully — you can sign in now.
        </p>
      )}
      {resetExpired && (
        <p className="mt-5 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-state-disputed">
          That password reset link is invalid or expired. Please request a new link.
        </p>
      )}
      {confirmError && (
        <p className="mt-5 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-state-disputed">
          That confirmation link is invalid or expired. Try signing in or sign
          up again.
        </p>
      )}
      {unconfirmed && (
        <p className="mt-5 rounded-md border border-amber/40 bg-amber-wash px-3 py-2 text-sm text-amber">
          Please confirm your email first — check your inbox for the link we
          sent.
        </p>
      )}
      {oauthError && (
        <p className="mt-5 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-state-disputed">
          Google sign-in failed or was cancelled. Please try again.
        </p>
      )}
      {telegramError && (
        <p className="mt-5 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-state-disputed">
          Telegram sign-in failed or was cancelled. Please try again.
        </p>
      )}
      {telegramUnconfigured && (
        <p className="mt-5 rounded-md border border-amber/40 bg-amber-wash px-3 py-2 text-sm text-amber">
          Telegram sign-in isn&apos;t configured on this server yet.
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-xs font-medium uppercase tracking-wide text-ink-soft"
          >
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label
              htmlFor="password"
              className="block text-xs font-medium uppercase tracking-wide text-ink-soft"
            >
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-amber hover:text-amber-soft transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        {error && <p className="text-sm text-state-disputed">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-paper-border" />
        <span className="text-xs uppercase tracking-wide text-ink-faint">
          or continue with
        </span>
        <span className="h-px flex-1 bg-paper-border" />
      </div>
      <div className="space-y-3">
        <GoogleLoginButton next={next} />
        <TelegramLoginButton botId={telegramBotId} />
      </div>

      <p className="mt-6 text-center text-sm text-ink-muted">
        New here?{" "}
        <Link href="/signup" className="text-amber underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
