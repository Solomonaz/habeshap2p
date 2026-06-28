"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions";
import { Logo } from "@/components/logo";
import { NotificationBell } from "@/components/notification-bell";
import type { NotificationRow } from "@/lib/notifications";
import type { AccountIdentity } from "@/lib/identity";

/**
 * Modern dashboard chrome for the whole /admin area: a fixed left rail on
 * desktop, an off-canvas drawer on mobile, and a sticky top bar with the
 * admin's identity. Rendered once by the admin layout so every console page
 * shares the same navigation and the content can stay focused on its data.
 */

type IconProps = { className?: string };

function Icon({ path, className = "" }: { path: React.ReactNode } & IconProps) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {path}
    </svg>
  );
}

const NAV: {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Extra path prefixes that should light this item up. */
  also?: string[];
}[] = [
  {
    href: "/admin",
    label: "Disputes",
    also: ["/admin/disputes"],
    icon: <Icon path={<><path d="M3 21h18" /><path d="M12 3v18" /><path d="M5 8l7-4 7 4" /><path d="M5 8l-2 5a3 3 0 0 0 6 0L7 8" /><path d="M17 8l-2 5a3 3 0 0 0 6 0l-2-5" /></>} />,
  },
  {
    href: "/admin/accounts",
    label: "Accounts",
    icon: <Icon path={<><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 6a3 3 0 0 1 0 6" /><path d="M18 14a6 6 0 0 1 3 5" /></>} />,
  },
  {
    href: "/admin/overview",
    label: "Ops overview",
    icon: <Icon path={<><path d="M4 19V5" /><path d="M4 19h16" /><rect x="7" y="11" width="3" height="5" /><rect x="12" y="7" width="3" height="9" /><rect x="17" y="13" width="3" height="3" /></>} />,
  },
  {
    href: "/admin/withdrawals",
    label: "Withdrawals",
    icon: <Icon path={<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>} />,
  },
  {
    href: "/admin/kyc",
    label: "Verifications",
    icon: <Icon path={<><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" /><path d="M9.5 12l1.8 1.8L15 10" /></>} />,
  },
  {
    href: "/admin/unmatched",
    label: "Unmatched",
    icon: <Icon path={<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.2a2.5 2.5 0 1 1 3 2.4c-.6.2-1 .8-1 1.6" /><path d="M12 17h.01" /></>} />,
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: <Icon path={<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></>} />,
  },
];

function isActive(pathname: string, item: (typeof NAV)[number]): boolean {
  if (item.href === "/admin") {
    return (
      pathname === "/admin" ||
      (item.also?.some((p) => pathname.startsWith(p)) ?? false)
    );
  }
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

function NavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={
              "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 " +
              (active
                ? "bg-amber/10 text-amber"
                : "text-ink-muted hover:bg-paper-sunken/70 hover:text-ink")
            }
          >
            <span
              aria-hidden
              className={
                "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-amber transition-all duration-200 " +
                (active ? "opacity-100" : "opacity-0 group-hover:opacity-40")
              }
            />
            <span
              className={
                "transition-transform duration-150 " +
                (active ? "" : "group-hover:translate-x-0.5")
              }
            >
              {item.icon}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarInner({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-5">
        <Logo height={28} glow />
        <span className="rounded-md bg-amber/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber">
          Admin
        </span>
      </div>
      <div className="flex-1 px-3">
        <p className="px-3 pb-2 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Console
        </p>
        <NavLinks pathname={pathname} onNavigate={onNavigate} />
      </div>
      <div className="border-t border-paper-border p-3">
        <Link
          href="/market"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-paper-sunken/70 hover:text-ink"
        >
          <Icon path={<><path d="M15 18l-6-6 6-6" /></>} />
          Back to app
        </Link>
      </div>
    </div>
  );
}

export function AdminShell({
  account,
  userId,
  notifications,
  children,
}: {
  account: AccountIdentity;
  userId?: string;
  notifications?: NotificationRow[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-paper-border bg-paper-raised md:block">
        <SidebarInner pathname={pathname} />
      </aside>

      {/* Mobile drawer */}
      <div
        className={
          "fixed inset-0 z-50 md:hidden " +
          (drawerOpen ? "pointer-events-auto" : "pointer-events-none")
        }
        aria-hidden={!drawerOpen}
      >
        <div
          onClick={() => setDrawerOpen(false)}
          className={
            "absolute inset-0 bg-black/60 transition-opacity duration-200 " +
            (drawerOpen ? "opacity-100" : "opacity-0")
          }
        />
        <aside
          className={
            "absolute left-0 top-0 h-full w-64 border-r border-paper-border bg-paper-raised shadow-2xl transition-transform duration-300 ease-out " +
            (drawerOpen ? "translate-x-0" : "-translate-x-full")
          }
        >
          <SidebarInner
            pathname={pathname}
            onNavigate={() => setDrawerOpen(false)}
          />
        </aside>
      </div>

      <div className="min-w-0 flex-1">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-paper-border bg-paper/80 px-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="btn-ghost px-2 py-2 md:hidden"
          >
            <Icon path={<><path d="M3 6h18M3 12h18M3 18h18" /></>} />
          </button>

          <div className="flex items-center gap-2.5 sm:ml-auto">
            {userId && (
              <NotificationBell userId={userId} initial={notifications ?? []} />
            )}
            <span className="hidden items-center gap-2 rounded-full border border-paper-border bg-paper-sunken/60 py-1 pl-1 pr-3 sm:inline-flex">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber to-amber-soft text-xs font-bold text-paper">
                {account.initials}
              </span>
              <span className="max-w-[14rem] truncate text-sm text-ink-soft">
                {account.label}
              </span>
            </span>
            <form action={signOut}>
              <button type="submit" className="btn-ghost px-3 py-1.5">
                Sign out
              </button>
            </form>
          </div>
        </header>

        <div key={pathname} className="animate-rise">{children}</div>
      </div>
    </div>
  );
}
