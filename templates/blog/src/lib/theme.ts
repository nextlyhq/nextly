/**
 * How the theme toggle reads and applies the saved theme. The layout's inline
 * init script does the same before React hydrates; it is a string, so it
 * cannot import this, and a test holds the two to the same result.
 */

export type Theme = "light" | "system" | "dark";

export const STORAGE_KEY = "nextly-theme";
export const THEMES: readonly Theme[] = ["light", "system", "dark"];
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The saved choice, or "system" when there is none or it is not one of the three. */
export function readTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  return THEMES.find(theme => theme === saved) ?? "system";
}

/** Paints the page in the choice, following the system's setting for "system". */
export function applyTheme(theme: Theme) {
  const prefersDark = window.matchMedia(DARK_QUERY).matches;
  const isDark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
}
