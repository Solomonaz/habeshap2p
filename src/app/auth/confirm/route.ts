import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Email confirmation landing. Supabase can deliver the confirmation two ways
 * depending on the email template:
 *   • token_hash + type  — when the template uses {{ .TokenHash }} (verifyOtp)
 *   • code               — the default PKCE flow, after Supabase's own /verify
 *                          endpoint confirms the address (exchangeCodeForSession)
 * We accept either, then sign the just-verified session out and bounce to
 * /login, keeping confirmation and sign-in as distinct steps.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createServerSupabase();

  let confirmed = false;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    confirmed = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    confirmed = !error;
  }

  if (confirmed) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?confirmed=1`);
  }

  return NextResponse.redirect(`${origin}/login?error=confirm`);
}
