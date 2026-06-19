import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/** Routes that require an authenticated session. */
const PROTECTED_PREFIXES = ["/dashboard", "/market", "/orders", "/verify"];

/**
 * Refreshes the Supabase auth session on every request (so server components
 * see a fresh token) and redirects unauthenticated users away from protected
 * routes. Adapted from the @supabase/ssr Next.js middleware pattern.
 */
export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run logic between createServerClient and getUser() — it refreshes
  // the token and writes the updated cookies onto `response`.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = PROTECTED_PREFIXES.some((p) =>
    request.nextUrl.pathname.startsWith(p),
  );
  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Defence in depth: even if a session exists, an unconfirmed email must not
  // reach protected routes. Supabase's "Confirm email" setting already blocks
  // password sign-in for unconfirmed accounts; this guards the case where that
  // setting is off or a session predates confirmation.
  if (user && isProtected && !user.email_confirmed_at) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "unconfirmed");
    return NextResponse.redirect(url);
  }

  return response;
}
