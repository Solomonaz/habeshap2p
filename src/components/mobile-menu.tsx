"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "@/app/actions";
import type { AccountIdentity } from "@/lib/identity";

type NavItem = { href: string; label: string; key: string };

/**
 * Mobile-only navigation. The hamburger sits where the Sign-out button lives on
 * desktop; tapping it opens a dropdown with the primary nav links, the account
 * identity, and Sign out. Hidden at md+ where the inline nav takes over.
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside tap or Escape so the menu never traps the user.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative md:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost flex h-9 w-9 items-center justify-center p-0"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          {open ? (
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ) : (
            <>
              <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Main menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-paper-border bg-paper-raised shadow-lg"
        >
          {account && (
            <div className="flex items-center gap-2 border-b border-paper-border/70 px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber to-amber-soft text-xs font-bold text-paper">
                {account.initials}
              </span>
              <span className="min-w-0 truncate text-xs text-ink-soft">
                {account.label}
              </span>
            </div>
          )}

          <nav className="py-1">
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
                    "block px-4 py-2.5 text-sm font-medium transition-colors " +
                    (isActive
                      ? "bg-paper-sunken text-ink"
                      : "text-ink-muted hover:bg-paper-sunken/60 hover:text-ink")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <form action={signOut} className="border-t border-paper-border/70">
            <button
              type="submit"
              role="menuitem"
              className="block w-full px-4 py-2.5 text-left text-sm font-medium text-ink-muted transition-colors hover:bg-paper-sunken/60 hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
