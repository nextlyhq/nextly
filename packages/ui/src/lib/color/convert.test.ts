/**
 * The conversions' contract, and a cross-check against an independent implementation.
 *
 * Two kinds of test here, and they catch different things:
 *
 * - **Round trips** catch a transform that is not the inverse of its partner. They are the
 *   cheapest way to find a transposed matrix row or a sign error, because both directions have to
 *   be wrong in exactly compensating ways to pass.
 * - **The culori cross-check** catches the case a round trip cannot: BOTH directions consistently
 *   wrong. A pair of transforms can be perfect inverses of each other and still not be OKLab.
 *   culori implements CSS Color 4 independently, so agreeing with it is evidence about the
 *   absolute values rather than only their symmetry.
 *
 * culori is a DEV dependency and stays one. It is the oracle, not the implementation.
 */
import { converter } from "culori";
import { describe, expect, it } from "vitest";

import {
  hsvToRgb,
  normalizeHue,
  oklchToRgb,
  rgbToHsv,
  rgbToOklch,
  type Rgb,
} from "./convert";

const culoriOklch = converter("oklch");
const culoriRgb = converter("rgb");

/**
 * A spread of colours: primaries, greys, near-black, near-white and assorted mid-tones.
 *
 * The six entries at 30-degree offsets are load-bearing rather than decorative. HSV converts by
 * six-sector branch, and at a sector BOUNDARY the two components a branch orders happen to be
 * equal — so pure yellow cannot tell a correct branch from one with its components swapped.
 * Reaching a sector is not the same as reaching the behaviour that distinguishes it.
 */
const SAMPLES: readonly Rgb[] = [
  { r: 1, g: 0.5, b: 0 },
  { r: 0.5, g: 1, b: 0 },
  { r: 0, g: 1, b: 0.5 },
  { r: 0, g: 0.5, b: 1 },
  { r: 0.5, g: 0, b: 1 },
  { r: 1, g: 0, b: 0.5 },
  { r: 0, g: 0, b: 0 },
  { r: 1, g: 1, b: 1 },
  { r: 1, g: 0, b: 0 },
  { r: 0, g: 1, b: 0 },
  { r: 0, g: 0, b: 1 },
  { r: 1, g: 1, b: 0 },
  { r: 0, g: 1, b: 1 },
  { r: 1, g: 0, b: 1 },
  { r: 0.5, g: 0.5, b: 0.5 },
  { r: 0.2, g: 0.4, b: 0.8 },
  { r: 0.31, g: 0.4, b: 0.8 },
  { r: 0.99, g: 0.98, b: 0.01 },
  { r: 0.01, g: 0.02, b: 0.03 },
  { r: 0.13, g: 0.77, b: 0.42 },
];

const label = (c: Rgb): string => `rgb(${c.r}, ${c.g}, ${c.b})`;

describe("hue normalisation", () => {
  it.each([
    [0, 0],
    [360, 0],
    [720, 0],
    [-30, 330],
    [-360, 0],
    [450, 90],
  ])("wraps %d to %d", (input, expected) => {
    expect(normalizeHue(input)).toBeCloseTo(expected, 10);
  });

  it("treats a non-finite hue as zero rather than propagating NaN", () => {
    // A NaN hue would otherwise spread silently through every channel of the result.
    expect(normalizeHue(Number.NaN)).toBe(0);
    expect(normalizeHue(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("HSV round trip", () => {
  it.each(SAMPLES.map(c => [label(c), c] as const))(
    "returns %s unchanged through HSV",
    (_name, colour) => {
      const back = hsvToRgb(rgbToHsv(colour));
      expect(back.r).toBeCloseTo(colour.r, 10);
      expect(back.g).toBeCloseTo(colour.g, 10);
      expect(back.b).toBeCloseTo(colour.b, 10);
    }
  );

  it("reports no hue for a grey, rather than an arbitrary one", () => {
    // Hue is genuinely undefined here. The value matters because a picker must not read this 0
    // as "the user chose red" when they dragged saturation to nothing.
    expect(rgbToHsv({ r: 0.5, g: 0.5, b: 0.5 }).s).toBe(0);
    expect(rgbToHsv({ r: 0.5, g: 0.5, b: 0.5 }).h).toBe(0);
  });

  it("keeps hue and saturation usable at zero value", () => {
    // Black through the round trip is still black, whatever hue accompanies it.
    const black = hsvToRgb({ h: 210, s: 0.8, v: 0 });
    expect(black).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("saturates rather than throwing when a drag overshoots", () => {
    // A picker drags these, and a rounding error past the end should not produce NaN.
    expect(hsvToRgb({ h: 0, s: 1.4, v: 1.2 })).toEqual({ r: 1, g: 0, b: 0 });
    expect(hsvToRgb({ h: 0, s: -0.3, v: -0.1 })).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("OKLCH round trip", () => {
  it.each(SAMPLES.map(c => [label(c), c] as const))(
    "returns %s unchanged through OKLCH",
    (_name, colour) => {
      const back = oklchToRgb(rgbToOklch(colour));
      // Eight-bit output is 1/255 apart, so agreement to four decimals is far finer than
      // anything that can be displayed or stored.
      expect(back.r).toBeCloseTo(colour.r, 4);
      expect(back.g).toBeCloseTo(colour.g, 4);
      expect(back.b).toBeCloseTo(colour.b, 4);
    }
  );
});

describe("agreement with culori, which implements CSS Color 4 independently", () => {
  it.each(SAMPLES.map(c => [label(c), c] as const))(
    "computes the same OKLCH as culori for %s",
    (_name, colour) => {
      const mine = rgbToOklch(colour);
      const theirs = culoriOklch({ mode: "rgb", ...colour });

      expect(mine.l).toBeCloseTo(theirs.l ?? 0, 6);
      expect(mine.c).toBeCloseTo(theirs.c ?? 0, 6);
      // Hue is meaningless for a near-grey, and the two implementations are entitled to
      // disagree about the direction of noise.
      if ((theirs.c ?? 0) > 1e-4) {
        expect(mine.h).toBeCloseTo(theirs.h ?? 0, 4);
      }
    }
  );

  it.each(SAMPLES.map(c => [label(c), c] as const))(
    "converts OKLCH back to the same sRGB as culori for %s",
    (_name, colour) => {
      const oklch = rgbToOklch(colour);
      const mine = oklchToRgb(oklch);
      const theirs = culoriRgb({
        mode: "oklch",
        l: oklch.l,
        c: oklch.c,
        h: oklch.h,
      });

      expect(mine.r).toBeCloseTo(theirs.r ?? 0, 4);
      expect(mine.g).toBeCloseTo(theirs.g ?? 0, 4);
      expect(mine.b).toBeCloseTo(theirs.b ?? 0, 4);
    }
  );
});

describe("colours a screen cannot show", () => {
  it("holds the hue when a colour is outside the gamut", () => {
    // The reason chroma is what gets given up. Clamping channels independently would clip red
    // without clipping green, changing the ratio between them — so the colour that appears is a
    // different HUE from the one asked for, which is the one property a person definitely chose.
    const asked = { l: 0.7, c: 0.4, h: 150 };
    const shown = rgbToOklch(oklchToRgb(asked));

    expect(shown.h).toBeCloseTo(asked.h, 0);
    expect(shown.l).toBeCloseTo(asked.l, 1);
    // And it did have to give something up, or this test would be proving nothing.
    expect(shown.c).toBeLessThan(asked.c);
  });

  it("leaves an in-gamut colour's chroma alone", () => {
    // The positive control for the reduction above: it must only engage when it has to.
    const asked = rgbToOklch({ r: 0.2, g: 0.4, b: 0.8 });
    const shown = rgbToOklch(oklchToRgb(asked));
    expect(shown.c).toBeCloseTo(asked.c, 4);
  });

  it("produces a displayable colour for an absurd chroma", () => {
    const shown = oklchToRgb({ l: 0.5, c: 10, h: 30 });
    for (const channel of [shown.r, shown.g, shown.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
      expect(Number.isFinite(channel)).toBe(true);
    }
  });
});
