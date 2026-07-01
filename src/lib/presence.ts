/**
 * Presence helpers (migration 0042). A user's `last_seen_at` is refreshed by a
 * client heartbeat (touch_presence) roughly once a minute; we treat them as
 * "online" if that stamp is within ONLINE_WINDOW_MS. Pure functions — safe to use
 * on the server (SSR snapshot) and the client (live polling).
 */

/** A heartbeat fires ~every 50s; allow a little slack before calling it offline. */
export const ONLINE_WINDOW_MS = 75_000;

/** Is this user currently online (seen within the presence window)? */
export function isOnline(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return false;
  const seen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(seen)) return false;
  return Date.now() - seen < ONLINE_WINDOW_MS;
}

/** Short human label: "Online", "Last seen 5m ago", or "Offline". */
export function presenceLabel(lastSeenAt: string | null | undefined): string {
  if (isOnline(lastSeenAt)) return "Online";
  if (!lastSeenAt) return "Offline";
  const ms = Date.now() - new Date(lastSeenAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return "Offline";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `Last seen ${Math.max(mins, 1)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Last seen ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `Last seen ${days}d ago`;
}
