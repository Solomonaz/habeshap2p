import type { User } from "@supabase/supabase-js";

/**
 * A human label + short avatar initials for the signed-in account, derived from
 * whichever identity source it was created with (email, Telegram, or — for
 * legacy rows — phone). Used by the site header's account chip. Telegram users
 * carry a synthetic email, so prefer the explicit Telegram metadata when present.
 */
export type AccountIdentity = { label: string; initials: string };

function initialsFrom(label: string): string {
  const cleaned = label.replace(/^[@+]/, "");
  return cleaned.slice(0, 2).toUpperCase();
}

/**
 * Turn an email into a name-like label when no real name is on file, so the UI
 * shows "Solomon Az1921" rather than a raw "solomon.az1921@gmail.com". Splits the
 * local part on separators and capitalises each word. A real `full_name` (when
 * present) always wins over this — see {@link accountIdentity}.
 */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const words = local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(" ") || email;
}

/** Initials from a person's name: "Solomon Alemu" → "SA"; "Solomon" → "SO". */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const [first, second] = parts;
  if (first && second) {
    return (first.charAt(0) + second.charAt(0)).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
}

/**
 * Account identity that prefers the profile's real name over the login handle.
 * `fullName` comes from the `users` table; when present (and non-blank) it wins
 * over the email/phone/Telegram label so the UI greets people by name. Falls
 * back to {@link accountLabel} otherwise.
 */
export function accountIdentity(
  user: User | null | undefined,
  fullName?: string | null,
): AccountIdentity {
  const trimmed = fullName?.trim();
  if (trimmed) {
    return { label: trimmed, initials: initialsFromName(trimmed) };
  }
  return accountLabel(user);
}

export function accountLabel(user: User | null | undefined): AccountIdentity {
  if (!user) return { label: "Account", initials: "··" };

  const tgUsername = user.user_metadata?.telegram_username as
    | string
    | undefined;
  if (tgUsername) {
    const label = `@${tgUsername}`;
    return { label, initials: initialsFrom(tgUsername) };
  }

  // Telegram synthetic emails are tg<id>@telegram.local — don't show those.
  if (user.email && !user.email.endsWith("@telegram.local")) {
    const name = nameFromEmail(user.email);
    return { label: name, initials: initialsFromName(name) };
  }

  if (user.phone) {
    const d = user.phone.replace(/\D/g, "");
    const label =
      d.startsWith("251") && d.length === 12
        ? `+251 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`
        : `+${d}`;
    return { label, initials: d.slice(-2) };
  }

  return { label: "Account", initials: "··" };
}
