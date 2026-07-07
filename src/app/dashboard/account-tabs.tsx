"use client";

import { useState, type ReactNode } from "react";

export type AccountTab = {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
};

/**
 * Tabbed account workspace. The dashboard used to be one long vertical scroll of
 * cards (deposit, send, withdraw, refer, …); this puts each behind a tab so any
 * action is one tap away instead of a scroll. All panels stay mounted (toggled
 * with `hidden`) so a half-filled form survives a tab switch. `[&_section]:!mt-0`
 * neutralises the top margins the individual cards bake in.
 */
export function AccountTabs({ tabs }: { tabs: AccountTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);

  return (
    <div className="mt-6">
      <nav
        aria-label="Account sections"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
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
                "flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors " +
                (isActive
                  ? "border-transparent bg-ink text-paper shadow-sm"
                  : "border-paper-border bg-paper-raised text-ink-soft hover:border-ink/20 hover:text-ink")
              }
            >
              <span className={isActive ? "text-paper" : "text-ink-faint"}>
                {t.icon}
              </span>
              {t.label}
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
