import { Suspense } from "react";
import { ForgotPasswordForm } from "./forgot-password-form";
import { AuthShell } from "@/components/auth-shell";

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <Suspense
        fallback={<div className="text-sm text-ink-muted">Loading reset form…</div>}
      >
        <ForgotPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
