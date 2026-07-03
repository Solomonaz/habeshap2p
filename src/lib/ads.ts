import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type AdRow = Database["public"]["Tables"]["ads"]["Row"];
export type PublicProfile =
  Database["public"]["Views"]["public_profiles"]["Row"];
export type AdWithPoster = AdRow & { poster: PublicProfile | null };

/**
 * Explicit column list with the numeric ETB columns cast to text. PostgREST
 * serializes `numeric` as a lossy JSON float otherwise; casting guarantees the
 * exact decimal string our types (and money math) expect.
 */
const AD_COLUMNS =
  "id, user_id, side, rate_etb::text, min_etb::text, max_etb::text, payment_methods, payer_name, notes, receiving_name, receiving_number, receiving_note, status, created_at";

/**
 * Loads the active order book and attaches each ad's poster reputation.
 *
 * Why two queries: RLS lets a user read only their OWN row in `users`, so we
 * cannot embed the poster via a normal join. Reputation is instead read from
 * the `public_profiles` view (safe columns only) and merged in. Works
 * identically with the server client (RLS as the user) and the browser client
 * used for live refetches.
 */
export async function fetchActiveAds(
  supabase: SupabaseClient<Database>,
): Promise<AdWithPoster[]> {
  const { data: ads, error } = await supabase
    .from("ads")
    .select(AD_COLUMNS)
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`failed to load ads: ${error.message}`);
  if (!ads || ads.length === 0) return [];

  const posterIds = [...new Set(ads.map((a) => a.user_id))];
  const { data: profiles, error: pErr } = await supabase
    .from("public_profiles")
    .select("*")
    .in("id", posterIds);
  if (pErr) throw new Error(`failed to load profiles: ${pErr.message}`);

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  return ads.map((ad) => ({ ...ad, poster: byId.get(ad.user_id) ?? null }));
}

/** Loads a single ad by id with its poster's public reputation (or null). */
export async function fetchAd(
  supabase: SupabaseClient<Database>,
  adId: string,
): Promise<AdWithPoster | null> {
  const { data: ad, error } = await supabase
    .from("ads")
    .select(AD_COLUMNS)
    .eq("id", adId)
    .maybeSingle();
  if (error) throw new Error(`failed to load ad: ${error.message}`);
  if (!ad) return null;

  const { data: profile } = await supabase
    .from("public_profiles")
    .select("*")
    .eq("id", ad.user_id)
    .maybeSingle();
  return { ...ad, poster: profile ?? null };
}

/** Loads a single user's public profile (safe columns) by id, or null. */
export async function fetchPublicProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<PublicProfile | null> {
  const { data } = await supabase
    .from("public_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  return data ?? null;
}

/** Loads the current user's own ads (any status) for management. */
export async function fetchMyAds(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<AdRow[]> {
  const { data, error } = await supabase
    .from("ads")
    .select(AD_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`failed to load your ads: ${error.message}`);
  return data ?? [];
}
