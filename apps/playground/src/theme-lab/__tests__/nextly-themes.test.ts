import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { themeToCss } from "../generate-css";
import { NEXTLY_THEMES } from "../themes";
import { validateTheme } from "../validate-contrast";

// The real shipped stylesheet supplies the `--color-*` scale (the
// theme-independent aliases and color-mix() shades); themes only carry the
// `--nx-*` tokens those aliases reference.
const THEME_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/ui/src/styles/theme.css"
);
const source = readFileSync(THEME_CSS, "utf8");

// Every assertion is driven off the array rather than a literal count, so
// adding a theme extends the suite instead of breaking it.
describe("nextly themes", () => {
  it("leads with mono as the control", () => {
    expect(NEXTLY_THEMES[0].id).toBe("mono");
  });

  it("has unique ids", () => {
    const ids = NEXTLY_THEMES.map(theme => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // A theme missing any required token throws here, which is the only signal
  // that a partial theme would otherwise give: at runtime it would silently
  // inherit the previously rendered theme's value.
  it.each(NEXTLY_THEMES)("$label generates complete css", theme => {
    expect(() => themeToCss(theme)).not.toThrow();
  });

  it.each(NEXTLY_THEMES)("$label passes every contrast pairing", theme => {
    const failures = validateTheme(theme, source);
    expect(
      failures,
      failures
        .map(f => `${f.mode}: ${f.label} ${f.ratio.toFixed(2)}:1`)
        .join("\n")
    ).toEqual([]);
  });
});
