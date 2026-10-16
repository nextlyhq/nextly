/**
 * The blog template reads the saved theme in two places: the inline script in
 * the layout, which paints before React hydrates, and the theme toggle, which
 * takes over after. The script is a string, so the two cannot share code; if
 * they ever accept different values, a stored choice one of them rejects
 * paints one theme and then flips to the other. This holds the two to the same
 * choices and the same fallback.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const BLOG = path.resolve(here, "../../../../templates/blog/src/app");
const layout = readFileSync(path.join(BLOG, "layout.tsx"), "utf-8");
const toggle = readFileSync(
  path.join(BLOG, "(frontend)/components/ThemeToggle.tsx"),
  "utf-8"
);

/** The values the toggle accepts, from its THEMES list. */
function toggleChoices(): string[] {
  const list = /const THEMES: readonly Theme\[\] = \[([^\]]*)\]/.exec(
    toggle
  )?.[1];
  return (list?.match(/"([a-z]+)"/g) ?? [])
    .map(value => value.slice(1, -1))
    .sort();
}

/** The values the init script compares the stored key with. */
function scriptChoices(): string[] {
  return [...layout.matchAll(/stored === "([a-z]+)"/g)]
    .map(match => match[1])
    .sort();
}

describe("the blog's two readings of the saved theme", () => {
  it("read the same key", () => {
    expect(layout).toContain('localStorage.getItem("nextly-theme")');
    expect(toggle).toContain('const STORAGE_KEY = "nextly-theme"');
  });

  it("accept the same three choices", () => {
    expect(toggleChoices()).toEqual(["dark", "light", "system"]);
    expect(scriptChoices()).toEqual(toggleChoices());
  });

  it("fall back to system for anything else", () => {
    expect(layout).toMatch(/\? stored : "system"/);
    expect(toggle).toMatch(/\?\? "system"/);
  });
});
