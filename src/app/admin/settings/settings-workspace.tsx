"use client";

import { useState, type ReactNode } from "react";

export type SettingsSection = {
  id: string;
  label: string;
  hint: string;
  icon: ReactNode;
  content: ReactNode;
};

/**
 * Sectioned settings shell. Instead of stacking every control in one endless
 * vertical column, related settings are grouped behind a sticky side-rail and
 * only the active group is shown. All panels stay mounted (toggled with the
 * `hidden` attribute) so in-progress form state survives a tab switch.
 *
 * The `[&_section]:!mt-0` on each panel neutralises the top margins the
 * individual form cards bake in, letting `space-y` own the vertical rhythm.
 */
export function SettingsWorkspace({ sections }: { sections: SettingsSection[] }) {
  const [active, setActive] = useState(sections[0]?.id);

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[13.5rem_1fr]">
      <nav
        aria-label="Settings sections"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:sticky lg:top-6 lg:mx-0 lg:h-fit lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
      >
        {sections.map((s) => {
          const isActive = s.id === active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              aria-current={isActive ? "page" : undefined}
              className={
                "group flex shrink-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors lg:w-full " +
                (isActive
                  ? "border-transparent bg-ink text-paper shadow-sm"
                  : "border-paper-border bg-paper-raised text-ink-soft hover:border-ink/20 hover:text-ink")
              }
            >
              <span
                className={
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors " +
                  (isActive
                    ? "bg-paper/15 text-paper"
                    : "bg-paper-sunken text-ink-faint group-hover:text-ink")
                }
              >
                {s.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight">
                  {s.label}
                </span>
                <span
                  className={
                    "mt-0.5 hidden truncate text-xs leading-tight lg:block " +
                    (isActive ? "text-paper/70" : "text-ink-faint")
                  }
                >
                  {s.hint}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0">
        {sections.map((s) => (
          <section
            key={s.id}
            hidden={s.id !== active}
            aria-labelledby={`settings-${s.id}`}
            className="[&_section]:!mt-0"
          >
            <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-paper-border pb-3">
              <h2
                id={`settings-${s.id}`}
                className="text-lg font-semibold text-ink"
              >
                {s.label}
              </h2>
              <p className="hidden text-xs text-ink-faint sm:block">{s.hint}</p>
            </div>
            <div className="space-y-5">{s.content}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
