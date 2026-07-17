/**
 * Unit tests for the WCAG color math, independent of the theme. These pin the
 * formulas to known reference values so a regression in the math surfaces here
 * (a precise, hand-checkable failure) rather than as a mysterious shift in the
 * token-contrast suite.
 */
import { wcagLuminance } from "culori";
import { describe, expect, it } from "vitest";

import {
  compositeOver,
  contrastRatio,
  relativeLuminance,
  toClampedRgb,
  toOpaque,
} from "../color";

describe("contrastRatio", () => {
  it("is 21:1 for black on white, the WCAG maximum", () => {
    const black = toClampedRgb("#000000");
    const white = toClampedRgb("#ffffff");
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
  });

  it("is 1:1 for a color against itself", () => {
    const gray = toClampedRgb("#767676");
    expect(contrastRatio(gray, gray)).toBeCloseTo(1, 5);
  });

  it("matches the classic #767676-on-white boundary (~4.54:1)", () => {
    // #767676 is the canonical gray that just clears 4.5:1 on white; a good
    // fixed point for the whole gamma -> linear -> luminance -> ratio chain.
    const gray = toClampedRgb("#767676");
    const white = toClampedRgb("#ffffff");
    expect(contrastRatio(gray, white)).toBeCloseTo(4.54, 2);
  });

  it("is symmetric in its arguments", () => {
    const a = toClampedRgb("#334155");
    const b = toClampedRgb("#e2e8f0");
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });
});

describe("compositeOver (alpha border over surface)", () => {
  it("blends 50% black over white to a mid gray of ~3.98:1", () => {
    // Hand-computed: 0*0.5 + 1*0.5 = 0.5 per channel -> luminance 0.21398,
    // contrast to white = (1 + 0.05) / (0.21398 + 0.05) = 3.98:1.
    const halfBlack = toClampedRgb("oklch(0 0 0 / 0.5)");
    const white = toClampedRgb("#ffffff");
    const composited = compositeOver(halfBlack, white);
    expect(composited.r).toBeCloseTo(0.5, 10);
    expect(composited.g).toBeCloseTo(0.5, 10);
    expect(composited.b).toBeCloseTo(0.5, 10);
    expect(contrastRatio(composited, white)).toBeCloseTo(3.98, 2);
  });

  it("shows why a raw 0.13-alpha border is unreadable until composited (~1.35:1)", () => {
    // This is the Primer gotcha the whole check exists for: the pre-fix
    // `--nx-border` was `oklch(0 0 0 / 0.13)`, which composites to 0.87 gray on
    // white and yields only 1.35:1, far under the 3:1 UI minimum.
    const faintBorder = toClampedRgb("oklch(0 0 0 / 0.13)");
    const white = toClampedRgb("#ffffff");
    expect(contrastRatio(compositeOver(faintBorder, white), white)).toBeCloseTo(
      1.35,
      2
    );
  });

  it("toOpaque composites a translucent color but returns an opaque one as-is", () => {
    const white = toClampedRgb("#ffffff");
    const composited = toOpaque("oklch(0 0 0 / 0.5)", white);
    expect(composited.alpha).toBe(1);
    expect(composited.r).toBeCloseTo(0.5, 10);

    const opaque = toOpaque("#123456", white);
    expect(opaque).toEqual(toClampedRgb("#123456"));
  });
});

describe("relativeLuminance", () => {
  // culori implements the same WCAG 2.x luminance; cross-checking guards against
  // a transcription error in our linearization / coefficients.
  it.each(["#ffffff", "#000000", "#767676", "#1e293b", "#c2410c", "#2563eb"])(
    "agrees with culori's wcagLuminance for %s",
    hex => {
      expect(relativeLuminance(toClampedRgb(hex))).toBeCloseTo(
        wcagLuminance(hex),
        10
      );
    }
  );
});
