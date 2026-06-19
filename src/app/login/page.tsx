import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { AuthShell } from "@/components/auth-shell";

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
