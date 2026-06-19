"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export function SignupForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

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
    "w-full rounded-md border border-paper-border bg-paper-raised px-3 py-2 " +
    "text-ink placeholder:text-ink-faint focus-visible:border-amber";
  const buttonClass =
    "w-full rounded-md bg-amber px-4 py-2 font-medium text-paper-raised " +
    "transition-colors hover:bg-amber-soft disabled:opacity-50";

  if (sent) {
    return (
      <div className="w-full max-w-sm rounded-card border border-paper-border bg-paper-raised p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Check your email</h1>
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
    <div className="w-full max-w-sm rounded-card border border-paper-border bg-paper-raised p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-ink">Create your account</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Sign up with your email. We&apos;ll send a link to confirm it&apos;s
        real.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="fullName" className="block text-sm text-ink-soft">
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
            className={`mt-1 ${inputClass}`}
          />
        </div>
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
            autoComplete="new-password"
            required
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="confirm" className="block text-sm text-ink-soft">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            placeholder="Re-enter your password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`mt-1 ${inputClass}`}
          />
        </div>
        {error && <p className="text-sm text-state-disputed">{error}</p>}
        <button type="submit" disabled={loading} className={buttonClass}>
          {loading ? "Creating…" : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-amber underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
