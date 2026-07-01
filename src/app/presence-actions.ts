"use server";

import { z } from "zod";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { isOnline } from "@/lib/presence";

/**
 * Presence (migration 0042). The heartbeat stamps the signed-in user's
 * last_seen_at; getPresence lets a client poll a counterparty's online state.
 * Both authenticate the caller first; the write only ever touches one column
 * (via the touch_presence SECURITY DEFINER RPC).
 */

/** Heartbeat: mark the signed-in user as seen now. No-op if not signed in. */
export async function touchPresence(): Promise<void> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  try {
    const admin = createAdminSupabase();
    await admin.rpc("touch_presence", { p_user: user.id });
  } catch {
    // Presence is best-effort; a missed heartbeat just shows "offline" briefly.
  }
}

const presenceSchema = z.object({ userId: z.string().uuid() });

/** A user's current presence — online flag + raw last_seen for the client label. */
export async function getPresence(
  userId: string,
): Promise<{ online: boolean; lastSeen: string | null }> {
  const parsed = presenceSchema.safeParse({ userId });
  if (!parsed.success) return { online: false, lastSeen: null };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { online: false, lastSeen: null };

  const admin = createAdminSupabase();
  const { data } = await admin
    .from("users")
    .select("last_seen_at")
    .eq("id", parsed.data.userId)
    .maybeSingle();
  const lastSeen = data?.last_seen_at ?? null;
  return { online: isOnline(lastSeen), lastSeen };
}
