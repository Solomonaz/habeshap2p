"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSubmitted(true);
  }

  const inputClass =
    "w-full rounded-lg border border-paper-border bg-paper-sunken/60 px-3 py-2.5 " +
    "text-ink placeholder:text-ink-faint focus-visible:border-amber";

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Reset your password</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Enter your email address and we&apos;ll send you a link to reset your password.
      </p>

      {submitted ? (
        <div className="mt-6 space-y-4 rounded-card border border-state-released/40 bg-buy-wash p-4">
          <p className="text-sm font-semibold text-state-released">
            Check your email!
          </p>
          <p className="text-xs text-ink-soft">
            We sent a password reset link to <strong className="text-ink">{email}</strong>. Click the link in the email to set a new password.
          </p>
          <Link
            href="/login"
            className="inline-block text-xs font-semibold text-amber hover:underline pt-2"
          >
            ← Back to sign in
          </Link>
        </div>
      ) : (
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

          {error && <p className="text-sm text-state-disputed">{error}</p>}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Sending reset link…" : "Send reset link"}
          </button>

          <p className="mt-6 text-center text-sm text-ink-muted">
            Remembered your password?{" "}
            <Link href="/login" className="text-amber underline">
              Sign in
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
