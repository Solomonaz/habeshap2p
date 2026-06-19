import Link from "next/link";
import { signOut } from "@/app/actions";
import { Logo } from "@/components/logo";
import { OrderNotifications } from "@/components/order-notifications";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin as fetchIsAdmin } from "@/lib/admin";
import type { AccountIdentity } from "@/lib/identity";

type Page = "market" | "mine" | "orders" | "dashboard" | "admin";

const NAV: { href: string; label: string; key: Page }[] = [
  { href: "/market", label: "Order book", key: "market" },
  { href: "/orders", label: "Orders", key: "orders" },
  { href: "/market/mine", label: "My ads", key: "mine" },
  { href: "/dashboard", label: "Account", key: "dashboard" },
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
  // Admin pages pass isAdmin explicitly (they already checked); elsewhere we
  // resolve it so the Admin link surfaces wherever an admin happens to be.
  let showAdmin = isAdmin ?? false;
  if (isAdmin === undefined && userId) {
    const supabase = await createServerSupabase();
    showAdmin = await fetchIsAdmin(supabase, userId);
  }

  const nav = showAdmin
    ? [...NAV, { href: "/admin", label: "Admin", key: "admin" as Page }]
    : NAV;

  return (
    <header className="sticky top-0 z-40 border-b border-paper-border/70 bg-paper/80 backdrop-blur-xl">
      {userId && <OrderNotifications userId={userId} />}
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-6">
        {/* Brand + primary nav */}
        <div className="flex items-center gap-7">
          <Link
            href="/market"
            aria-label="HabeshaP2P home"
            className="shrink-0 rounded-md focus-visible:ring-2 focus-visible:ring-amber"
          >
            <Logo />
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
                    "relative rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                    (isActive
                      ? "text-ink"
                      : "text-ink-muted hover:bg-paper-sunken/60 hover:text-ink")
                  }
                >
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
          {account && (
            <span className="hidden items-center gap-2 rounded-full border border-paper-border bg-paper-sunken/60 py-1 pl-1 pr-3 sm:inline-flex">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-amber to-amber-soft text-[11px] font-bold text-paper">
                {account.initials}
              </span>
              <span className="max-w-[12rem] truncate text-xs text-ink-soft">
                {account.label}
              </span>
            </span>
          )}
          <form action={signOut}>
            <button type="submit" className="btn-ghost px-3 py-1.5">
              Sign out
            </button>
          </form>
        </div>
      </div>

      {/* Mobile nav (wraps below the bar on small screens) */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-paper-border/60 px-4 py-1.5 md:hidden">
        {nav.map((item) => {
          const isActive = active === item.key;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={
                "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
                (isActive
                  ? "bg-paper-sunken text-ink"
                  : "text-ink-muted hover:text-ink")
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
