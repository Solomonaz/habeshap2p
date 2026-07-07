import Link from "next/link";
import { navIcon } from "@/components/nav-icons";

/**
 * Mobile bottom tab bar (app-shell style). Replaces the hamburger drawer as the
 * primary mobile navigation; the account menu now lives in the top-right profile
 * dropdown. Hidden at md+ where the inline top nav takes over. Fixed to the
 * bottom with a safe-area inset so it clears the phone's gesture bar.
 */
const TABS: { href: string; label: string; key: string }[] = [
  { href: "/market", label: "Home", key: "market" },
  { href: "/market/mine", label: "My ads", key: "mine" },
  { href: "/orders", label: "Orders", key: "orders" },
  { href: "/dashboard", label: "Wallet", key: "dashboard" },
];

export function BottomNav({ active }: { active?: string }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-paper-border bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      {TABS.map((t) => {
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={isActive ? "page" : undefined}
            className={
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors " +
              (isActive ? "text-ink" : "text-ink-faint hover:text-ink-soft")
            }
          >
            <span className={isActive ? "text-amber" : ""}>
              {navIcon(t.key)}
            </span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Floating "post an ad" button — the primary create action on mobile, sitting
 * just above the bottom tab bar. Mobile only.
 */
export function PostAdFab() {
  return (
    <Link
      href="/market/new"
      aria-label="Post an ad"
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-amber text-paper shadow-lg shadow-amber/30 transition-transform active:scale-95 md:hidden"
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
        <path d="M12 5v14M5 12h14" />
      </svg>
    </Link>
  );
}
