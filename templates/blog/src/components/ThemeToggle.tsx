"use client";

import { useEffect, useState } from "react";

/**
 * ThemeToggle - three-state segmented control (Light / System / Dark).
 *
 * Writes the preference to `localStorage["nextly-theme"]` and applies it
 * via `document.documentElement.dataset.theme`. The inline init script
 * in `src/app/layout.tsx` reads the same key before React hydrates so
 * the first paint is already the correct theme (no flash).
 *
 * When the user picks "system", we honor `prefers-color-scheme` and
 * subscribe to its change event so OS-level dark-mode toggles are
 * reflected live without a refresh.
 */

type Theme = "light" | "system" | "dark";

const STORAGE_KEY = "nextly-theme";

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const initial = stored ?? "system";
    setTheme(initial);
    applyTheme(initial);

    // When user is on "system", follow OS-level changes live.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const current =
        (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
      if (current === "system") applyTheme("system");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  function pick(next: Theme) {
    setTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  return (
    <fieldset
      className="inline-flex items-center gap-0.5 rounded-full border p-0.5"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-bg-surface)",
      }}
      aria-label="Theme"
    >
      <legend className="sr-only">Theme</legend>
      {(
        [
          { value: "light", label: "Light", icon: SunIcon },
          { value: "system", label: "System", icon: SystemIcon },
          { value: "dark", label: "Dark", icon: MoonIcon },
        ] as const
      ).map(({ value, label, icon: Icon }) => {
        const selected = theme === value;
        return (
          <label
            key={value}
            className="cursor-pointer"
            title={label}
            aria-label={label}
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={selected}
              onChange={() => pick(value)}
              className="peer sr-only"
            />
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full transition-colors peer-checked:text-[color:var(--color-accent-foreground)]"
              style={{
                background: selected ? "var(--color-fg)" : "transparent",
                color: selected
                  ? "var(--color-bg-surface)"
                  : "var(--color-fg-muted)",
              }}
            >
              <Icon />
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
