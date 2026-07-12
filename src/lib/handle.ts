/**
 * Synthetic trader identity helpers.
 *
 * The schema intentionally exposes no display name for a counterparty (only a
 * uuid + reputation via public_profiles), since accounts are phone-bound and we
 * don't collect usernames yet. To give the order book and chat a Binance-like
 * feel we derive a STABLE pseudonymous handle, avatar initial, and colour from
 * the user id. This is cosmetic only — never an identity or trust signal.
 *
 * RISK FLAG: a real product wants user-chosen, moderated display names. These
 * derived handles are an MVP stand-in and are noted as such in the README.
 */

const ADJECTIVES = [
  "Swift", "Gold", "Habesha", "Lion", "Blue", "Prime", "Nile",
  "Sheba", "Axum", "Rift", "Sun", "Star", "Falcon", "Cedar", "Onyx",
];
const NOUNS = [
  "Trader", "Exchange", "Desk", "Capital", "Market", "Hub", "Broker",
  "Vault", "Bridge", "Coin",
];

function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic display handle, e.g. "Nile_Trader_4F". */
export function traderHandle(id: string): string {
  const h = hash(id);
  // Use the UNSIGNED right shift: `>>` treats h as a signed 32-bit int, so for
  // h >= 2^31 it goes negative and `negative % len` yields a negative index →
  // `undefined` ("Prime_undefined_B3"). `>>>` keeps it unsigned.
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[(h >>> 8) % NOUNS.length];
  const suffix = id.replace(/-/g, "").slice(0, 2).toUpperCase();
  return `${adj}_${noun}_${suffix}`;
}

/** Single uppercase initial for the avatar. */
export function traderInitial(id: string): string {
  return traderHandle(id).charAt(0).toUpperCase();
}

/** Deterministic avatar background colour (HSL string). */
export function traderColor(id: string): string {
  const h = hash(id) % 360;
  return `hsl(${h} 55% 45%)`;
}

/**
 * Display name for a counterparty. Prefers the registered legal name
 * (public_profiles.full_name, captured at signup) and falls back to the stable
 * pseudonym for accounts that predate name capture or left it blank. The id is
 * still required so the fallback stays deterministic per-user.
 */
export function traderName(fullName: string | null | undefined, id: string): string {
  const name = fullName?.trim();
  return name && name.length > 0 ? name : traderHandle(id);
}

/** Avatar initial derived from the display name (real name when present). */
export function traderInitialFrom(
  fullName: string | null | undefined,
  id: string,
): string {
  return traderName(fullName, id).charAt(0).toUpperCase();
}

/**
 * PUBLIC marketplace display name (migration 0062). Prefers the trader's chosen
 * nickname (users.display_name), falls back to the registered legal name, then to
 * the stable pseudonym. COSMETIC ONLY — never use for payment-account names,
 * disputes, KYC, or admin surfaces, which must always show the verified legal
 * name (full_name). Use this in the order book and the trade/order counterparty
 * header, mirroring how Binance shows a nickname in the P2P list but the real
 * bank-account name at payment time.
 */
export function traderDisplay(
  displayName: string | null | undefined,
  fullName: string | null | undefined,
  id: string,
): string {
  const nick = displayName?.trim();
  if (nick && nick.length > 0) return nick;
  return traderName(fullName, id);
}

/** Avatar initial derived from the public marketplace display name. */
export function traderDisplayInitial(
  displayName: string | null | undefined,
  fullName: string | null | undefined,
  id: string,
): string {
  return traderDisplay(displayName, fullName, id).charAt(0).toUpperCase();
}
