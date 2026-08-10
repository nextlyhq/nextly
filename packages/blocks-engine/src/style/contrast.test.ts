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

  it("refuses an alpha that CSS would not accept", () => {
    // The two rgb() syntaxes are separate grammars. The space-separated form
    // takes its alpha only after a slash, so `rgb(0 0 0 0.5)` is invalid and a
    // browser drops the declaration outright. Reporting a ratio for it would
    // tell an author an unusable colour passes contrast.
    expect(parseColor("rgb(0 0 0 0.5)")).toBeUndefined();
    expect(checkContrast("rgb(0 0 0 0.5)", "#fff")).toBeUndefined();
    // Nor may the two syntaxes be mixed.
    expect(parseColor("rgb(0, 0, 0 / 0.5)")).toBeUndefined();
    // A comma with nothing between it and the next is a MISSING component, not
    // whitespace. Dropping it turns `rgb(0,,0,0)` into `rgb(0,0,0)`.
    for (const value of ["rgb(0,,0,0)", "rgb(,0,0,0)", "rgb(0,0,0,)"]) {
      expect(parseColor(value), value).toBeUndefined();
    }
    // The legacy grammar is three numbers or three percentages, never a mix.
    expect(parseColor("rgb(1, 2%, 3)")).toBeUndefined();
    // A component is a whole number, not a prefix of one.
    expect(parseColor("rgb(0 0 0abc)")).toBeUndefined();
    expect(parseColor("rgb(0, 0, 0 0.5)")).toBeUndefined();
  });

  it("still reads both forms CSS does accept", () => {
    // The tightening above has to stay a tightening.
    expect(parseColor("rgb(0 0 0 / 0.5)")?.a).toBeCloseTo(0.5, 5);
    expect(parseColor("rgba(0, 0, 0, 0.5)")?.a).toBeCloseTo(0.5, 5);
    expect(parseColor("rgb(0 0 0)")?.a).toBe(1);
    expect(parseColor("rgb(0, 0, 0)")?.a).toBe(1);
    // All-percentage legacy, and a mix in the MODERN form, which does allow it.
    expect(parseColor("rgb(100%, 0%, 0%)")?.r).toBe(255);
    expect(parseColor("rgb(100% 0 0)")?.r).toBe(255);
    // Whitespace around the space form is not a missing component.
    expect(parseColor("rgb( 0 0 0 )")?.a).toBe(1);
    // Exponent notation is valid CSS number syntax, and a colour written that
    // way renders — so refusing it made `checkContrast` silent about a real one.
    expect(parseColor("rgb(1e2 0 0 / 5e-1)")?.r).toBe(100);
    expect(parseColor("rgb(1e2 0 0 / 5e-1)")?.a).toBeCloseTo(0.5, 5);
    // A trailing dot is not a CSS number.
    expect(parseColor("rgb(1. 0 0)")).toBeUndefined();
  });

  it("reads an escaped function name as the function it is", () => {
    // `r\\67 b(...)` IS `rgb(...)` to a browser, so refusing it makes the
    // contrast check silent about a colour that renders.
    expect(parseColor("r\\67 b(255 0 0)")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    });
  });

  it("does not decode a channel, only the function name", () => {
    // `rgb(\\32 55 0 0)` is not `rgb(255 0 0)`: an escaped channel is an
    // identifier, not a number, so the browser drops the declaration. Decoding
    // the whole value reports a colour that never renders — the one thing this
    // function is arranged not to do.
    expect(parseColor("rgb(\\32 55 0 0)")).toBeUndefined();
    // The name may still carry escapes, which is what the decoding is for.
    expect(parseColor("r\\67 b(255 0 0)")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    });
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
