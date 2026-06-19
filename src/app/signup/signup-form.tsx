"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env";
import { TelegramLoginButton } from "@/components/telegram-login-button";
import { GoogleLoginButton } from "@/components/google-login-button";
import { PasswordInput } from "@/components/password-input";

export function SignupForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const telegramBotId = publicEnv.NEXT_PUBLIC_TELEGRAM_BOT_ID;
  const supabase = createClient();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (fullName.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Stored in auth.users.raw_user_meta_data; the signup trigger copies it
        // into public.users.full_name.
        data: { full_name: fullName.trim() },
        // Supabase emails a confirmation link to this route; clicking it proves
        // the inbox is real before the account can sign in.
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  const inputClass =
    "w-full rounded-lg border border-paper-border bg-paper-sunken/60 px-3 py-2.5 " +
    "text-ink placeholder:text-ink-faint focus-visible:border-amber";
  const labelClass =
    "block text-xs font-medium uppercase tracking-wide text-ink-soft";

  if (sent) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-ink">Check your email</h1>
        <p className="mt-2 text-sm text-ink-muted">
          We sent a confirmation link to{" "}
          <span className="font-medium text-ink">{email}</span>. Click it to
          verify your address, then sign in.
        </p>
        <Link
          href="/login"
          className="mt-6 block text-center text-sm text-amber underline"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Create your account</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Sign up with your email — we&apos;ll send a link to confirm it&apos;s
        real.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="fullName" className={labelClass}>
            Full name
          </label>
          <input
            id="fullName"
            type="text"
            autoComplete="name"
            required
            placeholder="As it appears on your ID"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="email" className={labelClass}>
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
          <label htmlFor="password" className={labelClass}>
            Password
          </label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="confirm" className={labelClass}>
            Confirm password
          </label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            required
            placeholder="Re-enter your password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        {error && <p className="text-sm text-state-disputed">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Creating…" : "Create account"}
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
        <GoogleLoginButton />
        <TelegramLoginButton botId={telegramBotId} />
      </div>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-amber underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
