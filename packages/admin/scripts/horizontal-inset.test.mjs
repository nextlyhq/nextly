/**
 * The arithmetic behind the build's refusal to ship a page-cancelling inset.
 *
 * The build can only say pass or fail on one stylesheet. These say what the
 * parts do, which is where the mistakes were: six revisions of this check each
 * compared a SPELLING — a class, a property, a value anchored whole, a
 * shorthand read at one position — and each was correct about the case in
 * front of it. Computing the distance is what ended that, so the computation is
 * what is worth pinning.
 */
import { describe, expect, it } from "vitest";

import {
  cancelsInset,
  components,
  horizontalOfMargin,
  toRem,
} from "./horizontal-inset.mjs";

const SPACING = 0.25;

describe("splitting a declaration's value", () => {
  it("keeps a calc whole, however deeply it nests", () => {
    // The failure this prevents is silent: a nested calc split into pieces
    // makes every position after it the wrong component.
    expect(components("calc(calc(var(--spacing) * 8) * -1)")).toEqual([
      "calc(calc(var(--spacing)*8)*-1)",
    ]);
    expect(components("0 calc(var(--spacing) * -8)")).toEqual([
      "0",
      "calc(var(--spacing)*-8)",
    ]);
  });

  it("separates the components a shorthand actually has", () => {
    expect(components("1rem 2rem 3rem 4rem")).toHaveLength(4);
  });
});

describe("evaluating a length", () => {
  it("agrees across every spelling of the same distance", () => {
    // One distance, five strings. This is the whole reason the check computes.
    for (const term of [
      "calc(var(--spacing)*-8)",
      "-2rem",
      "-32px",
      "calc(calc(var(--spacing)*8)*-1)",
      "calc(calc(calc(var(--spacing)*4)*2)*-1)",
    ]) {
      expect(toRem(term, SPACING), term).toBeCloseTo(-2);
    }
  });

  it("returns NaN for a term it does not understand", () => {
    // Not zero, and not a throw: an unrecognised term must not read as
    // harmless, and must not stop the build either.
    expect(toRem("var(--sidebar-width)", SPACING)).toBeNaN();
    expect(toRem("auto", SPACING)).toBeNaN();
  });
});

describe("reading a margin shorthand", () => {
  it.each([
    [["1rem"], ["1rem"]],
    [["1rem", "2rem"], ["2rem"]],
    [["1rem", "2rem", "3rem"], ["2rem"]],
    [["1rem", "2rem", "3rem", "4rem"], ["2rem", "4rem"]],
  ])("takes the horizontal side of %j", (parts, expected) => {
    expect(horizontalOfMargin(parts)).toEqual(expected);
  });
});

describe("whether a term cancels the page's inset", () => {
  it("refuses the inset and anything wider", () => {
    expect(cancelsInset("-2rem", SPACING)).toBe(true);
    expect(cancelsInset("calc(var(--spacing)*-12)", SPACING)).toBe(true);
  });

  it("allows the smaller negatives the sheet already ships", () => {
    // A card pulling its edge past its own padding, a rule overlap. A check
    // that refused these would be switched off the first time it fired.
    expect(cancelsInset("-1px", SPACING)).toBe(false);
    expect(cancelsInset("calc(var(--spacing)*-6)", SPACING)).toBe(false);
    expect(cancelsInset("calc(calc(var(--spacing)*4)*-1)", SPACING)).toBe(false);
  });

  it("allows a positive margin of the same size", () => {
    expect(cancelsInset("2rem", SPACING)).toBe(false);
  });
});
