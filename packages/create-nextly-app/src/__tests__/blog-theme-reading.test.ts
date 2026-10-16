/**
 * The blog template reads the saved theme in two places: the inline script in
 * the layout, which paints before React hydrates, and the theme toggle, which
 * takes over after. The script is a string, so the two cannot share code; if
 * they ever paint a stored value differently, the page shows one theme and
 * then flips to the other. This runs both against the same stored values and
 * system settings, and holds each to the theme that value should give.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyTheme,
  readTheme,
} from "../../../../templates/blog/src/lib/theme";

const here = path.dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(
  path.resolve(here, "../../../../templates/blog/src/app/layout.tsx"),
  "utf-8"
);
const initScript = /const themeInitScript = `([\s\S]*?)`;/.exec(layout)?.[1];

/** A browser whose storage holds `stored` under the blog's key, and nothing else. */
function browser(stored: string | null, prefersDark: boolean) {
  return {
    localStorage: {
      getItem: (key: string) => (key === "nextly-theme" ? stored : null),
    },
    window: { matchMedia: () => ({ matches: prefersDark }) },
    document: { documentElement: { dataset: {} as { theme?: string } } },
  };
}

/** The theme the layout's init script paints. */
function paintedByScript(stored: string | null, prefersDark: boolean) {
  const page = browser(stored, prefersDark);
  runInNewContext(initScript ?? "", page);
  return page.document.documentElement.dataset.theme;
}

/** The theme the toggle paints once React has hydrated. */
function paintedByToggle(stored: string | null, prefersDark: boolean) {
  const page = browser(stored, prefersDark);
  vi.stubGlobal("localStorage", page.localStorage);
  vi.stubGlobal("window", page.window);
  vi.stubGlobal("document", page.document);
  applyTheme(readTheme());
  return page.document.documentElement.dataset.theme;
}

const CASES: Array<
  [stored: string | null, prefersDark: boolean, theme: string]
> = [
  ["light", true, "light"],
  ["dark", false, "dark"],
  ["system", false, "light"],
  ["system", true, "dark"],
  // Nothing saved, or a value that is not one of the three: follow the system.
  // The values that are not one of the three run with a dark system setting,
  // because a reader that wrongly accepts one paints it light.
  [null, false, "light"],
  [null, true, "dark"],
  ["Dark", true, "dark"],
  ["Light", true, "dark"],
  ["auto", true, "dark"],
  ["", true, "dark"],
];

describe("the blog's two readings of the saved theme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("finds the layout's init script", () => {
    expect(initScript).toContain('localStorage.getItem("nextly-theme")');
  });

  it.each(CASES)(
    "paint %j with a dark system setting %s as %s",
    (stored, prefersDark, theme) => {
      expect(paintedByScript(stored, prefersDark)).toBe(theme);
      expect(paintedByToggle(stored, prefersDark)).toBe(theme);
    }
  );
});
