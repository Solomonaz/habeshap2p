import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";
import { AuthShell } from "@/components/auth-shell";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If the user arrived without an authenticated reset session (e.g., link expired or direct visit), redirect to login.
  if (!user) {
    redirect("/login?error=reset_expired");
  }

  return (
    <AuthShell>
      <Suspense
        fallback={<div className="text-sm text-ink-muted">Loading password update form…</div>}
      >
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
