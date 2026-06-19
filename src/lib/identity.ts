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
    return { label: user.email, initials: initialsFrom(user.email) };
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
