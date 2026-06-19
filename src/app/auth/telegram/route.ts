import { NextResponse, type NextRequest } from "next/server";
import {
  createServerSupabase,
  createAdminSupabase,
} from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env";
import {
  verifyTelegramAuth,
  telegramEmail,
  telegramPassword,
  telegramFullName,
} from "@/lib/telegram";

/**
 * Telegram Login Widget callback (stage 3 of the auth rework, see migration
 * 0014). The widget redirects here with the signed-in user's data + an HMAC
 * `hash`. We verify the signature, find-or-create the matching Supabase auth
 * user (synthetic tg<id>@telegram.local email + Telegram metadata the signup
 * trigger mirrors onto public.users), then mint a session by signing in with a
 * deterministic server-derived password.
 *
 * Everything sensitive (bot token, password derivation) stays server-side; the
 * browser only ever holds the signed Telegram payload it already had.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });

  const { TELEGRAM_BOT_TOKEN, SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  if (!TELEGRAM_BOT_TOKEN) {
    return NextResponse.redirect(`${origin}/login?error=telegram_unconfigured`);
  }

  const data = verifyTelegramAuth(params, TELEGRAM_BOT_TOKEN);
  if (!data) {
    return NextResponse.redirect(`${origin}/login?error=telegram`);
  }

  const tgId = data.id;
  const email = telegramEmail(tgId);
  const password = telegramPassword(tgId, SUPABASE_SERVICE_ROLE_KEY);
  const metadata = {
    telegram_id: tgId,
    telegram_username: data.username ?? null,
    full_name: telegramFullName(data),
  };

  const admin = createAdminSupabase();

  // Is there already a profile bound to this Telegram id? (telegram_id is a
  // bigint with a unique index — see 0014.)
  const numericId = Number(tgId);
  const { data: existing } = Number.isSafeInteger(numericId)
    ? await admin
        .from("users")
        .select("id")
        .eq("telegram_id", numericId)
        .maybeSingle()
    : { data: null };

  if (existing) {
    // Returning user: keep the derived password in sync (so sign-in works even
    // if it ever rotated) and refresh the cached Telegram username.
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      user_metadata: metadata,
    });
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=telegram`);
    }
  } else {
    // First time: create the auth row. The handle_new_user trigger provisions
    // public.users + wallet from this metadata.
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    });
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=telegram`);
    }
  }

  // Mint the session on the cookie-bound server client so the auth cookies land
  // on the response.
  const supabase = await createServerSupabase();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    return NextResponse.redirect(`${origin}/login?error=telegram`);
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
