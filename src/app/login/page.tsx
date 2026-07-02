import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to your HabeshaP2P account to buy and sell USDT for Ethiopian birr (ETB) with escrow protection.",
  alternates: { canonical: "/login" },
};

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense
        fallback={<div className="text-sm text-ink-muted">Loading sign-in…</div>}
      >
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
