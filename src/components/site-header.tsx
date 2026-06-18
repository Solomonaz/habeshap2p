import Link from "next/link";
import { signOut } from "@/app/actions";
import { OrderNotifications } from "@/components/order-notifications";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdmin as fetchIsAdmin } from "@/lib/admin";

type Page = "market" | "mine" | "orders" | "dashboard" | "admin";

const NAV: { href: string; label: string; key: Page }[] = [
  { href: "/market", label: "Order book", key: "market" },
  { href: "/orders", label: "Orders", key: "orders" },
  { href: "/market/mine", label: "My ads", key: "mine" },
  { href: "/dashboard", label: "Account", key: "dashboard" },
];

export async function SiteHeader({
  phone,
  active,
  userId,
  isAdmin,
}: {
  phone?: string | null;
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
    <header className="border-b border-paper-border bg-paper-raised">
      {userId && <OrderNotifications userId={userId} />}
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link
            href="/market"
            className="text-sm font-semibold uppercase tracking-wide text-ink"
          >
            HabeshaP2P
          </Link>
          <nav className="flex items-center gap-4">
            {nav.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active === item.key ? "page" : undefined}
                className={
                  active === item.key
                    ? "text-sm font-medium text-ink"
                    : "text-sm text-ink-muted hover:text-ink"
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {phone && (
            <span className="hidden font-amount text-xs text-ink-faint sm:inline">
              {phone}
            </span>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md border border-paper-border px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
