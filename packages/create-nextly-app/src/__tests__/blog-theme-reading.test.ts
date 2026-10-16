// @vitest-environment jsdom
/**
 * The blog template reads the saved theme in two places: the inline script in
 * the layout, which paints before React hydrates, and the theme toggle, which
 * takes over after. The script is a string, so the two cannot share code; if
 * they ever paint a stored value differently, the page shows one theme and
 * then flips to the other. This runs the script, and renders the toggle
 * itself, against the same stored values and system settings, and holds each
 * to the theme that value should give.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "../../../../templates/blog/src/app/(frontend)/components/ThemeToggle";

const here = path.dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(
  path.resolve(here, "../../../../templates/blog/src/app/layout.tsx"),
  "utf-8"
);
const initScript = /const themeInitScript = `([\s\S]*?)`;/.exec(layout)?.[1];

/**
 * A system setting's answer to a media query, as a browser gives it: dark
 * matches only the dark-scheme query, so a reader asking any other query
 * gets no match and paints light where the setting is dark.
 */
const systemAnswer = (prefersDark: boolean) => (query: string) => ({
  matches: prefersDark && query === "(prefers-color-scheme: dark)",
  addEventListener: () => {},
  removeEventListener: () => {},
});

/** A browser whose storage holds `stored` under the blog's key, and nothing else. */
function browser(stored: string | null, prefersDark: boolean) {
  return {
    localStorage: {
      getItem: (key: string) => (key === "nextly-theme" ? stored : null),
    },
    window: { matchMedia: systemAnswer(prefersDark) },
    document: { documentElement: { dataset: {} as { theme?: string } } },
  };
}

/** The theme the layout's init script paints. */
function paintedByScript(stored: string | null, prefersDark: boolean) {
  const page = browser(stored, prefersDark);
  runInNewContext(initScript ?? "", page);
  return page.document.documentElement.dataset.theme;
}

/** A page in jsdom with `stored` saved and the given system setting, painted by no one yet. */
function preparePage(stored: string | null, prefersDark: boolean) {
  localStorage.clear();
  if (stored !== null) localStorage.setItem("nextly-theme", stored);
  delete document.documentElement.dataset.theme;
  // jsdom has no matchMedia; this answers as a browser with that setting.
  vi.stubGlobal("matchMedia", systemAnswer(prefersDark));
}

/** The theme the toggle paints once it has rendered. */
async function paintedByToggle(stored: string | null, prefersDark: boolean) {
  preparePage(stored, prefersDark);
  await act(async () => {
    render(createElement(ThemeToggle));
  });
  return document.documentElement.dataset.theme;
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
    cleanup();
    vi.unstubAllGlobals();
  });

  it("finds the layout's init script", () => {
    expect(initScript).toContain('localStorage.getItem("nextly-theme")');
  });

  it.each(CASES)(
    "paint %j with a dark system setting %s as %s",
    async (stored, prefersDark, theme) => {
      expect(paintedByScript(stored, prefersDark)).toBe(theme);
      expect(await paintedByToggle(stored, prefersDark)).toBe(theme);
    }
  );

  it("saves and paints the choice the toggle is given", async () => {
    expect(await paintedByToggle(null, false)).toBe("light");

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    });

    expect(localStorage.getItem("nextly-theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(
      screen.getByRole<HTMLInputElement>("radio", { name: "Dark" }).checked
    ).toBe(true);
  });
});
