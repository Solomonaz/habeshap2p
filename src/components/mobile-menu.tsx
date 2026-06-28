"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { signOut } from "@/app/actions";
import { navIcon } from "@/components/nav-icons";
import type { AccountIdentity } from "@/lib/identity";

type NavItem = { href: string; label: string; key: string };

/**
 * Mobile-only navigation. The hamburger sits where the Sign-out button lives on
 * desktop; tapping it slides a sidenav drawer in from the right over a dimmed,
 * scroll-locked page. Closes when a link is chosen, the backdrop is tapped, the
 * ✕ is pressed, or Escape. Hidden at md+ where the inline nav takes over.
 *
 * The overlay is PORTALED to <body>: the site header carries `backdrop-blur`,
 * which makes it the containing block for `position: fixed` descendants — so a
 * drawer rendered inside the header would be positioned against the 64px-tall
 * header instead of the viewport (it collapses to a strip). The portal escapes
 * that context so `fixed inset-y-0` spans the full screen height.
 */
export function MobileMenu({
  nav,
  active,
  account,
}: {
  nav: NavItem[];
  active?: string;
  account?: AccountIdentity | null;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Portals need the DOM; only render the overlay after the client mounts.
  useEffect(() => setMounted(true), []);

  // Lock page scroll and wire Escape-to-close while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const overlay = (
    <div className="md:hidden">
      {/* Backdrop — fades in, dims the page, taps close the drawer. */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={
          "fixed inset-0 z-[60] bg-black/50 transition-opacity duration-300 " +
          (open ? "opacity-100" : "pointer-events-none opacity-0")
        }
      />

      {/* Drawer — slides in from the right. Always mounted so it animates both ways. */}
      <aside
        role="menu"
        aria-label="Main menu"
        aria-hidden={!open}
        className={
          "fixed inset-y-0 right-0 z-[70] flex w-72 max-w-[80vw] flex-col border-l border-paper-border bg-paper-raised shadow-2xl transition-transform duration-300 ease-out " +
          (open ? "translate-x-0" : "pointer-events-none translate-x-full")
        }
      >
        <div className="flex items-center justify-between border-b border-paper-border/70 px-4 py-3">
          {account ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber to-amber-soft text-xs font-bold text-paper">
                {account.initials}
              </span>
              <span className="min-w-0 truncate text-sm text-ink-soft">
                {account.label}
              </span>
            </span>
          ) : (
            <span className="text-sm font-semibold text-ink">Menu</span>
          )}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="btn-ghost flex h-8 w-8 shrink-0 items-center justify-center p-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {nav.map((item) => {
            const isActive = active === item.key;
            return (
              <Link
                key={item.key}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                aria-current={isActive ? "page" : undefined}
                className={
                  "flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors " +
                  (isActive
                    ? "bg-paper-sunken text-ink"
                    : "text-ink-muted hover:bg-paper-sunken/60 hover:text-ink")
                }
              >
                <span className={isActive ? "text-amber" : ""}>
                  {navIcon(item.key)}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <form action={signOut} className="border-t border-paper-border/70">
          <button
            type="submit"
            role="menuitem"
            className="block w-full px-5 py-3 text-left text-sm font-medium text-ink-muted transition-colors hover:bg-paper-sunken/60 hover:text-ink"
          >
            Sign out
          </button>
        </form>
      </aside>
    </div>
  );

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(true)}
        className="btn-ghost flex h-9 w-9 items-center justify-center p-0"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {mounted && createPortal(overlay, document.body)}
    </div>
  );
}
