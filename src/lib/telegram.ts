import "server-only";
import crypto from "node:crypto";

/**
 * Telegram Login Widget verification (server-only).
 *
 * The widget redirects the browser to our callback with the signed-in user's
 * data plus a `hash`. We MUST verify that hash before trusting any of it — it is
 * the only thing proving the payload really came from Telegram and wasn't forged
 * by whoever crafted the request. The scheme (per Telegram's docs):
 *
 *   secret_key        = SHA256(bot_token)                      // raw bytes
 *   data_check_string = sorted "key=value" of every field
 *                       EXCEPT hash, joined by "\n"
 *   expected_hash     = HMAC_SHA256(data_check_string, secret_key)  // hex
 *
 * We compare in constant time and also reject stale payloads so an intercepted
 * callback URL can't be replayed days later.
 */

export type TelegramAuthData = {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string;
  hash: string;
};

// Reject logins older than this. The widget hands the payload to the browser
// immediately, so a generous window still leaves no useful replay surface.
const MAX_AGE_SECONDS = 86_400; // 24h

/**
 * Returns the validated payload when the signature and freshness check pass,
 * or null otherwise. `params` is the flat query-string map from the callback.
 */
export function verifyTelegramAuth(
  params: Record<string, string>,
  botToken: string,
): TelegramAuthData | null {
  const hash = params.hash;
  if (!hash || !params.id || !params.auth_date) return null;

  const dataCheckString = Object.keys(params)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const expected = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // Constant-time comparison; bail if the hex is malformed / wrong length.
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(expected, "hex");
    b = Buffer.from(hash, "hex");
  } catch {
    return null;
  }
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.auth_date);
  if (!Number.isFinite(authDate)) return null;
  if (Date.now() / 1000 - authDate > MAX_AGE_SECONDS) return null;

  return params as TelegramAuthData;
}

/**
 * Synthetic email that keys the Supabase auth row for a Telegram account.
 * Telegram doesn't give us an email, but Supabase auth needs one; identity.ts
 * knows to never display addresses ending in @telegram.local.
 */
export function telegramEmail(id: string): string {
  return `tg${id}@telegram.local`;
}

/**
 * Deterministic, server-only session password for a Telegram account. We derive
 * it from the bot token (a secret that never reaches the client) so we can
 * re-mint a session on every login without storing a password anywhere. The
 * value is unguessable without the bot token.
 */
export function telegramPassword(id: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`tg-auth:${id}`)
    .digest("hex");
}

/** Compose a display name from the Telegram first/last name, or null. */
export function telegramFullName(d: TelegramAuthData): string | null {
  const name = [d.first_name, d.last_name].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : null;
}
