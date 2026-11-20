// @vitest-environment jsdom
/**
 * The shared Button's `link` variant reads under any brand: its words reach
 * AA's 4.5:1 for small text on every surface a link button sits on, in light
 * and dark, and it is underlined at rest, so it reads as a link without
 * relying on colour.
 *
 * `--nx-primary` is a fill a site's brand may set to any colour. The variant
 * drew its words in it, and under the e2e suite's indigo `#6366f1` they read
 * as low as 4.22:1 on a dark popover and 3.80:1 on a dark warning alert. The
 * words now take the text colour; the brand keeps the fills, borders and
 * rings it was made for.
 *
 * jsdom computes no stylesheet, so the colour the class paints is resolved
 * from the theme file, with the brand declared the way the admin's server
 * stylesheet declares it for indigo.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { compositeOver, contrastRatio } from "../../styles/contrast/color";
import {
  parseThemeScale,
  parseThemeTokens,
} from "../../styles/contrast/parse-theme";
import { resolveColor } from "../../styles/contrast/resolve";
import { Button } from "../button";

afterEach(cleanup);

const themeCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../styles/theme.css"),
  "utf8"
);
const theme = parseThemeTokens(themeCss);
const scale = parseThemeScale(themeCss);

/**
 * The indigo brand as `getBrandingCss({ colors: { primary: "#6366f1" } })`
 * writes it, for light and dark alike.
 */
const INDIGO_BRAND: [string, string][] = [
  ["--nx-primary", "hsl(238.7 83.5% 66.7%)"],
  ["--nx-primary-foreground", "hsl(0 0% 0%)"],
  ["--nx-ring", "hsl(238.7 83.5% 66.7%)"],
];

/** The surfaces a link button sits on: the page, a card, a popover, alerts. */
const SURFACES = [
  "background",
  "card",
  "popover",
  "warning-surface",
  "danger-surface",
];

/** AA for small text. */
const SMALL_TEXT = 4.5;

function linkClasses(): string[] {
  render(
    <Button variant="link" size="sm">
      Open as form
    </Button>
  );
  return screen
    .getByRole("button", { name: "Open as form" })
    .className.split(/\s+/);
}

/** Every ratio the words' colour reaches, lowest first, with where. */
function ratios(ink: string): { ratio: number; where: string }[] {
  const token = ink.replace(/^text-/, "");
  const measured = (["light", "dark"] as const).flatMap(mode => {
    const ctx = { tokens: new Map([...theme[mode], ...INDIGO_BRAND]), scale };
    return SURFACES.map(surface => {
      const ground = resolveColor(`var(--color-${surface})`, ctx);
      const words = compositeOver(
        resolveColor(`var(--color-${token})`, ctx),
        ground
      );
      return {
        ratio: contrastRatio(words, ground),
        where: `${mode} ${surface}`,
      };
    });
  });
  return measured.sort((a, b) => a.ratio - b.ratio);
}

describe("the shared Button's link variant", () => {
  it("draws its words in a colour that reads on every surface, in light and dark, under an indigo brand", () => {
    // The class that paints the words: `text-sm` sizes them, so only a class
    // naming a theme colour counts.
    const ink =
      linkClasses().find(name =>
        scale.has(`--color-${name.replace(/^text-/, "")}`)
      ) ?? "";
    expect(ink).toMatch(/^text-/);
    const [lowest] = ratios(ink);
    expect(
      lowest?.ratio,
      `${ink} reads ${lowest?.ratio.toFixed(2)}:1 on ${lowest?.where}`
    ).toBeGreaterThanOrEqual(SMALL_TEXT);
  });

  it("is underlined at rest, so it reads as a link without the brand's colour", () => {
    expect(linkClasses()).toContain("underline");
  });
});
