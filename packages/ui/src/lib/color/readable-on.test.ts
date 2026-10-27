/**
 * A chart colour made readable on the surfaces a mark is drawn on.
 *
 * WCAG 2.2 1.4.11 asks 3:1 for the graphical parts of a chart. A tenant's
 * brand colours are not known when the theme is built, so they are checked
 * when they arrive: one that already reads is left exactly as given, and one
 * that does not keeps its hue and chroma and moves its lightness, as little as
 * it takes, until it reads on every surface. A brand colour is never refused.
 */
import { describe, expect, it } from "vitest";

import { oklchToRgb, rgbToOklch, type Rgb } from "./convert";
import { parseHex, toHex } from "./hex";
import { readableOn } from "./readable-on";
import { contrastRatio } from "./wcag";

const hex = (value: string): Rgb => {
  const parsed = parseHex(value);
  if (parsed === null) throw new Error(`not a colour: ${value}`);
  return { r: parsed.r, g: parsed.g, b: parsed.b };
};
const grey = (l: number): Rgb => oklchToRgb({ l, c: 0, h: 0 });

/** The theme's card, popover and muted surfaces, as `theme.css` declares them. */
const LIGHT = [grey(1), grey(0.99), grey(0.97)];
const DARK = [grey(0.14), grey(0.18), grey(0.23)];

const lowest = (color: Rgb, surfaces: readonly Rgb[]) =>
  Math.min(...surfaces.map(surface => contrastRatio(color, surface)));

describe("the WCAG contrast ratio", () => {
  it("matches the published values for known pairs", () => {
    expect(contrastRatio(hex("#ffffff"), hex("#000000"))).toBeCloseTo(21, 5);
    // The two greys either side of 4.5:1 on white.
    expect(contrastRatio(hex("#777777"), hex("#ffffff"))).toBeCloseTo(4.48, 2);
    expect(contrastRatio(hex("#767676"), hex("#ffffff"))).toBeCloseTo(4.54, 2);
    // Symmetric.
    expect(contrastRatio(hex("#ffffff"), hex("#767676"))).toBeCloseTo(4.54, 2);
  });
});

describe("a colour that already reads", () => {
  it("is returned exactly as given, in light and in dark", () => {
    const blue = hex("#1d4ed8");
    expect(lowest(blue, LIGHT)).toBeGreaterThanOrEqual(3);
    expect(readableOn(blue, LIGHT)).toEqual(blue);
    const sky = hex("#7dd3fc");
    expect(lowest(sky, DARK)).toBeGreaterThanOrEqual(3);
    expect(readableOn(sky, DARK)).toEqual(sky);
  });

  it("is returned exactly even when it is not a colour hex can carry", () => {
    // 🔴 Off the 8-bit grid, so neither a rounding nor a nudge to a
    // neighbouring lightness could hand it back looking unchanged.
    const precise = { r: 0.1234567, g: 0.2345678, b: 0.7654321 };
    expect(lowest(precise, LIGHT)).toBeGreaterThanOrEqual(3);
    expect(readableOn(precise, LIGHT)).toBe(precise);
  });
});

describe("a colour that does not read", () => {
  it.each([
    ["a pale yellow on the light surfaces", "#fde68a", LIGHT],
    ["a pale pink on the light surfaces", "#fbcfe8", LIGHT],
    ["a deep navy on the dark surfaces", "#1e1b4b", DARK],
    ["a dark red on the dark surfaces", "#450a0a", DARK],
  ] as const)(
    "%s reaches 3:1 on every surface, keeping its hue",
    (_, given, surfaces) => {
      const before = hex(given);
      expect(lowest(before, surfaces)).toBeLessThan(3);
      const after = readableOn(before, surfaces);
      expect(lowest(after, surfaces)).toBeGreaterThanOrEqual(3);
      // On-brand: the hue the tenant chose, within what 8-bit output allows.
      const hueBefore = rgbToOklch(before).h;
      const hueAfter = rgbToOklch(after).h;
      const turned = Math.abs(((hueAfter - hueBefore + 540) % 360) - 180);
      expect(turned).toBeLessThan(4);
    }
  );

  it("moves lightness as little as it takes", () => {
    // 🔴 The separating case: a function that jumped to black or white would
    // also reach 3:1. One step back toward the original must not.
    const before = hex("#fde68a");
    const after = readableOn(before, LIGHT);
    const { l, c, h } = rgbToOklch(after);
    const closer = oklchToRgb({ l: l + 0.01, c, h });
    expect(lowest(closer, LIGHT)).toBeLessThan(3);
    expect(rgbToOklch(after).l).toBeGreaterThan(0.3);
  });

  it("is a colour hex carries exactly, so the ratio holds on the colour as it is drawn", () => {
    for (const [given, surfaces] of [
      ["#fde68a", LIGHT],
      ["#1e1b4b", DARK],
    ] as const) {
      const after = readableOn(hex(given), surfaces);
      // Every channel on the 8-bit grid: writing it as hex changes nothing.
      for (const channel of [after.r, after.g, after.b]) {
        expect(
          Math.abs(channel * 255 - Math.round(channel * 255))
        ).toBeLessThan(1e-9);
      }
      expect(hex(toHex(after))).toEqual(after);
      expect(lowest(hex(toHex(after)), surfaces)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("the extremes", () => {
  it("darkens pure white on a light card to a grey that reads", () => {
    const after = readableOn(hex("#ffffff"), LIGHT);
    expect(lowest(after, LIGHT)).toBeGreaterThanOrEqual(3);
    expect(rgbToOklch(after).c).toBeLessThan(0.01);
  });

  it("lightens pure black on a dark card to a grey that reads", () => {
    const after = readableOn(hex("#000000"), DARK);
    expect(lowest(after, DARK)).toBeGreaterThanOrEqual(3);
  });

  it("moves a near-grey that sits on its surface", () => {
    const after = readableOn(hex("#3a3a3a"), DARK);
    expect(lowest(after, DARK)).toBeGreaterThanOrEqual(3);
  });

  it("never refuses: surfaces no colour can read on still get the best there is", () => {
    // A white and a black surface together: mid-grey reads on both, so this
    // is answerable; the test is that an impossible minimum still returns.
    const after = readableOn(hex("#ff0000"), [grey(1), grey(0)], 12);
    expect(after).toEqual(expect.objectContaining({ r: expect.any(Number) }));
  });
});

describe("its own output", () => {
  it.each([
    ["#fde68a", LIGHT],
    ["#1e1b4b", DARK],
    ["#ffffff", LIGHT],
  ] as const)("%s comes back unchanged the second time", (given, surfaces) => {
    const once = readableOn(hex(given), surfaces);
    expect(readableOn(once, surfaces)).toEqual(once);
  });
});

describe("readableOn, at a text minimum", () => {
  it("holds a brand primary used as small text to 4.5:1 on the background and its 5% tint", () => {
    // The same adjuster, at the ratio text needs: `#6366f1` reads about
    // 4.07:1 as text on a 5% tint of itself, under the 4.5:1 AA asks.
    const brand = hex("#6366f1");
    const background = grey(0.99);
    const tint: Rgb = {
      r: brand.r * 0.05 + background.r * 0.95,
      g: brand.g * 0.05 + background.g * 0.95,
      b: brand.b * 0.05 + background.b * 0.95,
    };
    const surfaces = [background, tint];
    expect(lowest(brand, surfaces)).toBeLessThan(4.5);
    const readable = readableOn(brand, surfaces, 4.5);
    expect(lowest(readable, surfaces)).toBeGreaterThanOrEqual(4.5);
    // The brand's hue, kept.
    expect(Math.abs(rgbToOklch(readable).h - rgbToOklch(brand).h)).toBeLessThan(
      4
    );
  });
});
