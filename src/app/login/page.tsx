import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <Suspense
        fallback={
          <div className="text-sm text-ink-muted">Loading sign-in…</div>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
