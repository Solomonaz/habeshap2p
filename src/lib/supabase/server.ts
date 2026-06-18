import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicEnv, getServerEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Session-bound server client (anon key + the user's auth cookies). Queries run
 * AS THE USER, so Row Level Security still applies. Use this for reads/writes in
 * server components, route handlers, and server actions that act on behalf of
 * the signed-in user.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component where cookies are read-only.
            // Safe to ignore when middleware refreshes the session.
          }
        },
      },
    },
  );
}

/**
 * Admin client (service-role key). BYPASSES Row Level Security entirely.
 *
 * Use ONLY for trusted server-side operations that must cross user boundaries:
 * the escrow ledger money-moves, cron auto-cancel, admin dispute resolution,
 * and withdrawal signing. Never expose its results raw to a user without an
 * explicit authorization check first. Importing this module from a client
 * component is a build error thanks to "server-only".
 */
export function createAdminSupabase() {
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  return createSupabaseClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
