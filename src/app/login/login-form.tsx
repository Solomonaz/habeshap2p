"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";
  const justConfirmed = searchParams.get("confirmed") === "1";
  const errorParam = searchParams.get("error");
  const confirmError = errorParam === "confirm";
  const unconfirmed = errorParam === "unconfirmed";

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
    "w-full rounded-md border border-paper-border bg-paper-raised px-3 py-2 " +
    "text-ink placeholder:text-ink-faint focus-visible:border-amber";
  const buttonClass =
    "w-full rounded-md bg-amber px-4 py-2 font-medium text-paper-raised " +
    "transition-colors hover:bg-amber-soft disabled:opacity-50";

  return (
    <div className="w-full max-w-sm rounded-card border border-paper-border bg-paper-raised p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-ink">Sign in</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Welcome back. Sign in with your email and password.
      </p>

      {justConfirmed && (
        <p className="mt-4 rounded-md border border-state-released/40 bg-buy-wash px-3 py-2 text-sm text-state-released">
          Email confirmed — you can sign in now.
        </p>
      )}
      {confirmError && (
        <p className="mt-4 rounded-md border border-sell/40 bg-sell-wash px-3 py-2 text-sm text-state-disputed">
          That confirmation link is invalid or expired. Try signing in or sign
          up again.
        </p>
      )}
      {unconfirmed && (
        <p className="mt-4 rounded-md border border-amber/40 bg-amber-wash px-3 py-2 text-sm text-amber">
          Please confirm your email first — check your inbox for the link we
          sent.
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm text-ink-soft">
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
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm text-ink-soft">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`mt-1 ${inputClass}`}
          />
        </div>
        {error && <p className="text-sm text-state-disputed">{error}</p>}
        <button type="submit" disabled={loading} className={buttonClass}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-ink-muted">
        New here?{" "}
        <Link href="/signup" className="text-amber underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
