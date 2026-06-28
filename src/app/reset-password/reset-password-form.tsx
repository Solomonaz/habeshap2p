"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PasswordInput } from "@/components/password-input";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({
      password,
    });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }

    router.replace("/login?reset=1");
    router.refresh();
  }

  const inputClass =
    "w-full rounded-lg border border-paper-border bg-paper-sunken/60 px-3 py-2.5 " +
    "text-ink placeholder:text-ink-faint focus-visible:border-amber";

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Set new password</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Choose a strong new password for your HabeshaP2P account.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="password"
            className="block text-xs font-medium uppercase tracking-wide text-ink-soft"
          >
            New Password
          </label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            placeholder="Minimum 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-xs font-medium uppercase tracking-wide text-ink-soft"
          >
            Confirm New Password
          </label>
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            required
            placeholder="Re-enter new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        {error && <p className="text-sm text-state-disputed">{error}</p>}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Updating password…" : "Update password"}
        </button>
      </form>
    </div>
  );
}
