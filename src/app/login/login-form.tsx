"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Step = "phone" | "otp";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStep("otp");
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: "sms",
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
    "font-amount text-ink placeholder:text-ink-faint focus-visible:border-amber";
  const buttonClass =
    "w-full rounded-md bg-amber px-4 py-2 font-medium text-paper-raised " +
    "transition-colors hover:bg-amber-soft disabled:opacity-50";

  return (
    <div className="w-full max-w-sm rounded-card border border-paper-border bg-paper-raised p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-ink">Sign in</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Your account is bound to your phone number.
      </p>

      {step === "phone" ? (
        <form onSubmit={sendOtp} className="mt-6 space-y-4">
          <div>
            <label htmlFor="phone" className="block text-sm text-ink-soft">
              Phone number
            </label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              required
              placeholder="+251911234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={`mt-1 ${inputClass}`}
            />
            <p className="mt-1 text-xs text-ink-faint">
              Use international format, e.g. +251911234567.
            </p>
          </div>
          {error && <p className="text-sm text-state-disputed">{error}</p>}
          <button type="submit" disabled={loading} className={buttonClass}>
            {loading ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyOtp} className="mt-6 space-y-4">
          <div>
            <label htmlFor="token" className="block text-sm text-ink-soft">
              Verification code
            </label>
            <input
              id="token"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              placeholder="123456"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className={`mt-1 ${inputClass}`}
            />
            <p className="mt-1 text-xs text-ink-faint">
              Sent to {phone}.{" "}
              <button
                type="button"
                onClick={() => setStep("phone")}
                className="text-amber underline"
              >
                Change number
              </button>
            </p>
          </div>
          {error && <p className="text-sm text-state-disputed">{error}</p>}
          <button type="submit" disabled={loading} className={buttonClass}>
            {loading ? "Verifying…" : "Verify & sign in"}
          </button>
        </form>
      )}
    </div>
  );
}
