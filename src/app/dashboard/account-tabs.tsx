"use client";

import { useState, type ReactNode } from "react";

export type AccountTab = {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
};

/**
 * Account action grid. The selectors are icon tiles laid out in a wrapping grid
 * (4 across on mobile, more on wider screens) so nothing is hidden off-screen or
 * needs horizontal scrolling. Tapping a tile shows that panel below; all panels
 * stay mounted (toggled with `hidden`) so a half-filled form survives a switch.
 * `[&_section]:!mt-0` neutralises the top margins the individual cards bake in.
 */
export function AccountTabs({ tabs }: { tabs: AccountTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);

  return (
    <div className="mt-6">
      <nav
        aria-label="Account sections"
        className="grid grid-cols-4 gap-2 sm:grid-cols-5"
      >
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              aria-current={isActive ? "page" : undefined}
              className={
                "flex flex-col items-center gap-1.5 rounded-xl border px-1 py-3 transition-colors " +
                (isActive
                  ? "border-amber/50 bg-amber-wash"
                  : "border-paper-border bg-paper-raised hover:border-ink/20")
              }
            >
              <span
                className={
                  "flex h-9 w-9 items-center justify-center rounded-full transition-colors " +
                  (isActive
                    ? "bg-amber text-paper"
                    : "bg-paper-sunken text-ink-soft")
                }
              >
                {t.icon}
              </span>
              <span
                className={
                  "text-[11px] font-medium leading-tight " +
                  (isActive ? "text-amber" : "text-ink-soft")
                }
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-4">
        {tabs.map((t) => (
          <div key={t.id} hidden={t.id !== active} className="[&_section]:!mt-0">
            {t.content}
          </div>
        ))}
      </div>
    </div>
  );
}
