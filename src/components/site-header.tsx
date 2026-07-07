import Link from "next/link";
import { Logo } from "@/components/logo";
import { MobileMenu } from "@/components/mobile-menu";
import { ProfileMenu } from "@/components/profile-menu";
import { OrderNotifications } from "@/components/order-notifications";
import { PresenceHeartbeat } from "@/components/presence-heartbeat";
import { createServerSupabase } from "@/lib/supabase/server";
import { initialsFromName, type AccountIdentity } from "@/lib/identity";
import { navIcon } from "@/components/nav-icons";
import { NotificationBell } from "@/components/notification-bell";
import { fetchNotifications, type NotificationRow } from "@/lib/notifications";

type Page = "market" | "mine" | "orders" | "dashboard" | "admin";

// Home (the order book at /market) leads the nav; the logo also links there.
// "Account" is intentionally NOT here — it lives in the profile dropdown (and the
// mobile drawer) so it isn't duplicated in the top nav.
const NAV: { href: string; label: string; key: Page }[] = [
  { href: "/market", label: "Home", key: "market" },
  { href: "/orders", label: "Orders", key: "orders" },
  { href: "/market/mine", label: "My ads", key: "mine" },
];

export async function SiteHeader({
  account,
  active,
  userId,
  isAdmin,
}: {
  account?: AccountIdentity | null;
  active?: Page;
  userId?: string;
  isAdmin?: boolean;
}) {
  // One profile read serves two needs: the display name (we greet by the real
  // name, not the login email) and — when the caller didn't already resolve it —
  // whether the Admin link should show. Admin pages pass isAdmin explicitly, so
  // there we only need the name. `account` (email/handle) stays the fallback.
  let showAdmin = isAdmin ?? false;
  let display = account;
  let contact: string | null = null;
  let notifications: NotificationRow[] = [];
  if (userId) {
    const supabase = await createServerSupabase();
    const [{ data }, notes] = await Promise.all([
      supabase
        .from("users")
        .select("full_name, is_admin, email, telegram_username")
        .eq("id", userId)
        .maybeSingle(),
      fetchNotifications(supabase, userId),
    ]);
    if (isAdmin === undefined) showAdmin = data?.is_admin === true;
    const name = data?.full_name?.trim();
    if (name) {
      display = { label: name, initials: initialsFromName(name) };
    }
    // How the account signed in: Telegram username wins; otherwise the real
    // email (Telegram accounts carry a synthetic tg…@telegram.local we hide).
    const tg = data?.telegram_username?.trim();
    const email = data?.email?.trim();
    if (tg) contact = `@${tg}`;
    else if (email && !email.endsWith("@telegram.local")) contact = email;
    notifications = notes;
  }

  const nav = showAdmin
    ? [...NAV, { href: "/admin", label: "Admin", key: "admin" as Page }]
    : NAV;

  return (
    <header className="sticky top-0 z-40 border-b border-paper-border/70 bg-paper/80 backdrop-blur-xl">
      {userId && <OrderNotifications userId={userId} />}
      {userId && <PresenceHeartbeat />}
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-6">
        {/* Brand + primary nav */}
        <div className="flex items-center gap-7">
          <Link
            href="/market"
            aria-label="HabeshaP2P home"
            className="shrink-0 rounded-md focus-visible:ring-2 focus-visible:ring-amber"
          >
            <Logo height={38} glow />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((item) => {
              const isActive = active === item.key;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={
                    "relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                    (isActive
                      ? "text-ink"
                      : "text-ink-muted hover:bg-paper-sunken/60 hover:text-ink")
                  }
                >
                  <span className={isActive ? "text-amber" : ""}>
                    {navIcon(item.key)}
                  </span>
                  {item.label}
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-amber"
                    />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Account cluster */}
        <div className="flex items-center gap-2.5">
          {userId && (
            <NotificationBell userId={userId} initial={notifications} />
          )}
          {/* Desktop: the profile chip opens a dropdown with the account info,
              quick links, and sign out (no more standalone sign-out button). */}
          {display && (
            <ProfileMenu
              name={display.label}
              initials={display.initials}
              contact={contact}
              isAdmin={showAdmin}
            />
          )}

          {/* Mobile: hamburger holds the nav links, account info + sign out. */}
          <MobileMenu
            nav={nav}
            active={active}
            account={display}
            contact={contact}
          />
        </div>
      </div>
    </header>
  );
}
