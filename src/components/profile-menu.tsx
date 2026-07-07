"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "@/app/actions";

/**
 * The signed-in account chip, upgraded to a click-to-open dropdown. Consolidates
 * what used to be a static name pill + a separate "Sign out" button into one
 * menu that also shows how the user is signed in (email or @telegram) and quick
 * links. Closes on outside-click or Escape. Desktop only (sm+); mobile uses the
 * drawer in MobileMenu.
 */
export function ProfileMenu({
  name,
  initials,
  contact,
  isAdmin,
}: {
  name: string;
  initials: string;
  /** Email address, or @telegram-username for Telegram sign-ins. */
  contact: string | null;
  isAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemClass =
    "flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-paper-sunken/70 hover:text-ink";

  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          "flex items-center gap-2 rounded-full border py-1 pl-1 pr-2 transition-colors " +
          (open
            ? "border-amber/50 bg-amber-wash"
            : "border-paper-border bg-paper-sunken/60 hover:border-ink/25")
        }
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-amber to-amber-soft text-[11px] font-bold text-paper">
          {initials}
        </span>
        <span className="max-w-[10rem] truncate text-xs text-ink-soft">
          {name}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className={
            "shrink-0 text-ink-faint transition-transform " +
            (open ? "rotate-180" : "")
          }
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-paper-border bg-paper-raised shadow-xl"
        >
          {/* Identity header */}
          <div className="flex items-center gap-3 border-b border-paper-border/70 bg-paper-sunken/40 px-4 py-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber to-amber-soft text-sm font-bold text-paper">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{name}</p>
              {contact && (
                <p className="truncate text-xs text-ink-faint">{contact}</p>
              )}
            </div>
          </div>

          {/* Quick links */}
          <div className="py-1">
            <Link
              href="/dashboard"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={itemClass}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 0 0 1 1h3m10-11l2 2m-2-2v10a1 1 0 0 1-1 1h-3m-6 0a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1m-6 0h6" />
              </svg>
              Account &amp; wallet
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                role="menuitem"
                onClick={() => setOpen(false)}
                className={itemClass}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3l7 4v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V7l7-4z" />
                </svg>
                Admin console
              </Link>
            )}
          </div>

          <form action={signOut} className="border-t border-paper-border/70">
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-sell transition-colors hover:bg-sell-wash"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
