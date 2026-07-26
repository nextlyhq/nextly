import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MONO } from "../themes/mono";
import { validateTheme } from "../validate-contrast";

// The real shipped stylesheet supplies the `--color-*` scale (the
// theme-independent aliases and color-mix() shades); themes only carry the
// `--nx-*` tokens those aliases reference.
const THEME_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/ui/src/styles/theme.css"
);
const source = readFileSync(THEME_CSS, "utf8");

describe("validateTheme", () => {
  it("reports no failures for the shipped Mono theme", () => {
    expect(validateTheme(MONO, source)).toEqual([]);
  });

  it("reports a failure when foreground and background collide", () => {
    const unreadable = {
      ...MONO,
      id: "unreadable",
      light: { ...MONO.light, foreground: "oklch(1 0 0)" },
    };
    const failures = validateTheme(unreadable, source);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0].mode).toBe("light");
    expect(failures[0].ratio).toBeLessThan(failures[0].required);
  });
});
