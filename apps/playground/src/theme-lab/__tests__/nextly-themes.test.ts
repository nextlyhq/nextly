import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { themeToCss } from "../generate-css";
import { EXPECTED_CONTRAST_FAILURES, NEXTLY_THEMES } from "../themes";
import { validateTheme } from "../validate-contrast";

// The real shipped stylesheet supplies the `--color-*` scale (the
// theme-independent aliases and color-mix() shades); themes only carry the
// `--nx-*` tokens those aliases reference.
const THEME_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/ui/src/styles/theme.css"
);
const source = readFileSync(THEME_CSS, "utf8");

// The per-theme assertions are driven off the array rather than a literal
// count, so they extend themselves; only the total is pinned, below.
describe("nextly themes", () => {
  // The set is complete, so the count is asserted: a theme silently dropped
  // from the array would otherwise just shrink the suite and still pass.
  it("ships four themes led by mono as the control", () => {
    expect(NEXTLY_THEMES).toHaveLength(4);
    expect(NEXTLY_THEMES[0].id).toBe("mono");
  });

  it("has unique ids", () => {
    const ids = NEXTLY_THEMES.map(theme => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The switcher renders a description under every theme name, so a theme
  // that shipped without one would show a blank line rather than fail
  // anywhere. Uniqueness is asserted alongside because a description copied
  // from the row above is the same defect with a different symptom: two
  // themes claiming to be different in the same words.
  it("gives every theme its own one-line description", () => {
    for (const theme of NEXTLY_THEMES) {
      expect(theme.description.trim(), theme.id).not.toBe("");
      expect(theme.description, theme.id).not.toContain("\n");
    }
    const descriptions = NEXTLY_THEMES.map(theme => theme.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  // A theme missing any required token throws here, which is the only signal
  // that a partial theme would otherwise give: at runtime it would silently
  // inherit the previously rendered theme's value.
  it.each(NEXTLY_THEMES)("$label generates complete css", theme => {
    expect(() => themeToCss(theme)).not.toThrow();
  });

  // Most themes are expected to pass everything. The three edge themes are
  // scored against a recorded expectation instead, because their misses are the
  // measurement they exist to produce; an unrecorded theme still defaults to
  // zero. The listed failures stay in the assertion message either way, so a
  // surprise arrives with the mode, the pairing, and the ratio already in hand.
  it.each(NEXTLY_THEMES)("$label matches its contrast expectation", theme => {
    const failures = validateTheme(theme, source);
    const expected = EXPECTED_CONTRAST_FAILURES[theme.id] ?? 0;
    expect(
      failures.length,
      failures
        .map(f => `${f.mode}: ${f.label} ${f.ratio.toFixed(2)}:1`)
        .join("\n")
    ).toBe(expected);
  });
});
