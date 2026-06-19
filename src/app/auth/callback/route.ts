import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * OAuth callback (Google, etc.). Distinct from /auth/confirm: an email
 * confirmation verifies an address and then bounces to /login, but an OAuth
 * sign-in should KEEP the freshly minted session and land the user in the app.
 *
 * Supabase redirects here with `?code=...`; we exchange it for a session (which
 * sets the auth cookies) and forward to the dashboard, or `next` when supplied.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
