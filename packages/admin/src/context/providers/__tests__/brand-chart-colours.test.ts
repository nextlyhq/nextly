/**
 * A tenant's brand colours as chart marks: held to 3:1 on the surfaces a mark
 * is drawn on, in each mode, by their lightness alone, and never refused.
 */
import { readFileSync } from "node:fs";

import { oklchToRgb, parseHex, type Rgb } from "@nextlyhq/ui/color";
import { describe, expect, it } from "vitest";

import {
  CHART_SURFACES,
  brandingCss,
  chartColourFor,
  parseBrandColour,
} from "../BrandingProvider";

/** WCAG 2.x contrast, written out here so the test does not grade itself with the code's own. */
function contrast(a: Rgb, b: Rgb): number {
  const lin = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const lum = ({ r, g, b: blue }: Rgb) =>
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(blue);
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const rgbOf = (css: string): Rgb => {
  const parsed = parseBrandColour(css);
  if (!parsed) throw new Error(`not a colour: ${css}`);
  return parsed;
};
const lowest = (css: string, mode: "light" | "dark") =>
  Math.min(
    ...CHART_SURFACES[mode].map(surface =>
      contrast(rgbOf(css), oklchToRgb(surface))
    )
  );

/** A pale yellow: under 3:1 on the light card, well over it on the dark one. */
const PALE = "hsl(55 95% 80%)";
/** A deep navy: under 3:1 on the dark card, well over it on the light one. */
const NAVY = "hsl(230 60% 14%)";

describe("the surfaces a chart mark is drawn on", () => {
  it("are the theme's card, track and tooltip in each mode, as theme.css sets them", () => {
    // 🔴 Held to the file, so a theme change cannot leave the adjustment
    // measuring against surfaces the admin no longer draws.
    const theme = readFileSync(
      new URL("../../../../../ui/src/styles/theme.css", import.meta.url),
      "utf8"
    );
    const lightnesses = (token: string) =>
      [
        ...theme.matchAll(
          new RegExp(`--nx-${token}: oklch\\(([\\d.]+) 0 0\\)`, "g")
        ),
      ].map(match => Number(match[1]));
    const [card, muted, popover] = ["card", "muted", "popover"].map(
      lightnesses
    );
    // One value in the light block and one in the dark, in that order.
    expect([card, muted, popover].every(values => values!.length === 2)).toBe(
      true
    );
    expect(CHART_SURFACES.light.map(s => s.l)).toEqual([
      card![0],
      muted![0],
      popover![0],
    ]);
    expect(CHART_SURFACES.dark.map(s => s.l)).toEqual([
      card![1],
      muted![1],
      popover![1],
    ]);
  });
});

describe("a brand colour as a chart mark", () => {
  it("is adjusted to 3:1 in the mode it fails, and left exactly as given in the mode it reads", () => {
    expect(lowest(PALE, "light")).toBeLessThan(3);
    const light = chartColourFor(PALE, "light");
    expect(light).not.toBe(PALE);
    expect(lowest(light, "light")).toBeGreaterThanOrEqual(3);
    expect(chartColourFor(PALE, "dark")).toBe(PALE);

    expect(lowest(NAVY, "dark")).toBeLessThan(3);
    const dark = chartColourFor(NAVY, "dark");
    expect(lowest(dark, "dark")).toBeGreaterThanOrEqual(3);
    expect(chartColourFor(NAVY, "light")).toBe(NAVY);
  });

  it("keeps the brand's hue when it moves it", () => {
    const moved = parseHex(chartColourFor(PALE, "light"));
    expect(moved).not.toBeNull();
    // Still a yellow: red and green well above blue, as the brand's are.
    expect(moved!.r).toBeGreaterThan(moved!.b);
    expect(moved!.g).toBeGreaterThan(moved!.b);
  });

  it("reads the forms the admin is sent, and draws anything else as given", () => {
    expect(parseBrandColour("hsl(239 84.3% 64.7%)")).toBeDefined();
    expect(parseBrandColour("hsl(239, 84.3%, 64.7%)")).toBeDefined();
    expect(parseBrandColour("#6366f1")).toBeDefined();
    expect(chartColourFor("var(--brand)", "light")).toBe("var(--brand)");
  });
});

describe("the brand's stylesheet", () => {
  it("writes the chart slots per mode, each adjusted for that mode, and every other token for both", () => {
    const css = brandingCss({ primary: PALE, accent: NAVY });
    expect(css).toContain(
      `.nextly-admin, .nextly-admin.dark { --nx-primary: ${PALE};`
    );
    expect(css).toContain(
      `.nextly-admin { --nx-chart-1: ${chartColourFor(PALE, "light")}; --nx-chart-2: ${NAVY}; }`
    );
    expect(css).toContain(
      `.nextly-admin.dark { --nx-chart-1: ${PALE}; --nx-chart-2: ${chartColourFor(NAVY, "dark")}; }`
    );
    expect(brandingCss({})).toBeUndefined();
  });
});
