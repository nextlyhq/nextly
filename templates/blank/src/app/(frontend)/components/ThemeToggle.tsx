"use client";

import { useEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
const THEMES: readonly Theme[] = ["light", "dark", "system"];
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Everything showing the theme in this tab. The browser's `storage` event
 * only reaches other tabs, so a change made here is announced here by hand.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** The saved choice, or "system" when there is none or it is not one of the three. */
function readTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  return THEMES.find(theme => theme === saved) ?? "system";
}

function saveTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  for (const listener of listeners) listener();
}

function applyTheme(theme: Theme) {
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia(DARK_QUERY).matches);
  document.documentElement.classList.toggle("dark", isDark);
}

export function ThemeToggle() {
  // Read from storage rather than copied into state by an effect. The server
  // renders "system"; after hydration React swaps in the saved choice.
  const theme = useSyncExternalStore<Theme>(
    subscribe,
    readTheme,
    () => "system"
  );

  // Keep the page's colours in step with the choice, and with the system's
  // setting for as long as "system" is the choice.
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const query = window.matchMedia(DARK_QUERY);
    const follow = () => applyTheme("system");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [theme]);

  const handleThemeChange = (newTheme: Theme) => saveTheme(newTheme);

  return (
    <div className="fixed top-6 right-6 flex items-center border border-foreground/10 bg-background p-1 z-50">
      <button
        onClick={() => handleThemeChange("light")}
        className={`p-1.5 transition-colors cursor-pointer ${
          theme === "light"
            ? "text-foreground bg-foreground/5"
            : "text-slate-400 hover:text-foreground"
        }`}
        aria-label="Light theme"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="w-4 h-4"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M3 12h2.25m.386-6.364l1.591 1.591M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
          />
        </svg>
      </button>

      <button
        onClick={() => handleThemeChange("system")}
        className={`p-1.5 transition-colors cursor-pointer ${
          theme === "system"
            ? "text-foreground bg-foreground/5"
            : "text-slate-400 hover:text-foreground"
        }`}
        aria-label="System theme"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="w-4 h-4"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"
          />
        </svg>
      </button>

      <button
        onClick={() => handleThemeChange("dark")}
        className={`p-1.5 transition-colors cursor-pointer ${
          theme === "dark"
            ? "text-foreground bg-foreground/5"
            : "text-slate-400 hover:text-foreground"
        }`}
        aria-label="Dark theme"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="w-4 h-4"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
          />
        </svg>
      </button>
    </div>
  );
}
