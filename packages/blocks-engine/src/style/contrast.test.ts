/**
 * Anchored to WCAG's own numbers, not to the other implementation.
 *
 * `packages/ui` computes the same two formulas for the admin theme. Neither
 * imports the other — that package is React and this one is runtime-free — so
 * the way they are kept honest is that both agree with the specification. These
 * are the ratios WCAG 2 states.
 */
import { describe, expect, it } from "vitest";

import { checkContrast, contrastRatio, parseColor } from "./contrast";

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

describe("contrastRatio", () => {
  it("is 21 for black on white, the maximum the formula produces", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
  });

  it("is 1 for a colour against itself", () => {
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it("is symmetric, since the formula orders by luminance", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(
      contrastRatio(WHITE, BLACK),
      10
    );
  });

  it("matches the published value for #767676 on white", () => {
    // The canonical example of a colour that just clears AA for body text:
    // 4.54:1. A formula that got the sRGB transfer function wrong lands near
    // 4.0 and would pass text that fails.
    const grey = { r: 0x76, g: 0x76, b: 0x76, a: 1 };
    expect(contrastRatio(grey, WHITE)).toBeCloseTo(4.54, 2);
  });
});

describe("parseColor", () => {
  it("reads the hex forms, including the alpha ones", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#2563eb")).toEqual({ r: 37, g: 99, b: 235, a: 1 });
    expect(parseColor("#0000")?.a).toBe(0);
    expect(parseColor("#00000080")?.a).toBeCloseTo(0.502, 3);
  });

  it("reads both rgb syntaxes", () => {
    expect(parseColor("rgb(37, 99, 235)")).toEqual({
      r: 37,
      g: 99,
      b: 235,
      a: 1,
    });
    expect(parseColor("rgb(37 99 235 / 50%)")?.a).toBeCloseTo(0.5, 5);
    expect(parseColor("rgba(0,0,0,.25)")?.a).toBeCloseTo(0.25, 5);
  });

  it("refuses what it cannot read rather than guessing", () => {
    // A figure computed from a misread colour is worse than none, because it
    // is a number somebody acts on.
    for (const value of [
      "rebeccapurple",
      "hsl(210 50% 40%)",
      "var(--x)",
      "oklch(0.6 0.1 250)",
      "",
    ]) {
      expect(parseColor(value), value).toBeUndefined();
    }
  });
});

describe("checkContrast", () => {
  it("grades against the WCAG thresholds", () => {
    expect(checkContrast("#000", "#fff")?.level).toBe("AAA");
    expect(checkContrast("#767676", "#fff")?.level).toBe("AA");
    // 3:1 clears large text and UI components but not body text.
    expect(checkContrast("#949494", "#fff")?.level).toBe("AA-large");
    expect(checkContrast("#bbb", "#fff")?.level).toBe("fail");
  });

  it("answers the question most rules actually ask", () => {
    expect(checkContrast("#767676", "#fff")?.passesBodyText).toBe(true);
    expect(checkContrast("#949494", "#fff")?.passesBodyText).toBe(false);
  });

  it("composites a translucent foreground before judging it", () => {
    // The same rgba is readable on white and invisible on black; a ratio taken
    // before compositing describes neither.
    const onWhite = checkContrast("rgba(0,0,0,0.5)", "#fff")?.ratio ?? 0;
    const opaque = checkContrast("#000", "#fff")?.ratio ?? 0;
    expect(onWhite).toBeGreaterThan(1);
    expect(onWhite).toBeLessThan(opaque);
  });

  it("composites a translucent background too", () => {
    // A half-transparent black background is drawn over the page, so judging
    // it as opaque reports a ratio nobody sees.
    const translucent = checkContrast("#fff", "rgba(0,0,0,0.5)")?.ratio ?? 0;
    const opaque = checkContrast("#fff", "#000")?.ratio ?? 0;
    expect(translucent).toBeLessThan(opaque);
  });

  it("says nothing when a colour cannot be read", () => {
    // `undefined` rather than a default: a caller that cannot tell a verdict
    // from a fallback will show the fallback as one.
    expect(checkContrast("var(--brand)", "#fff")).toBeUndefined();
    expect(checkContrast("#fff", "hsl(0 0% 0%)")).toBeUndefined();
  });
});
