/**
 * The baseline's units, which are the whole mechanism by which an author's
 * typography reaches a heading.
 *
 * These defaults compile to `:where(h1)` — a rule on the ELEMENT — while
 * anything an author sets on the page or on a containing block arrives by
 * INHERITANCE. A direct rule beats an inherited value regardless of what either
 * weighs, so the authored value cannot win a specificity contest and no
 * selector change fixes it. Sizing in `em` makes the default a MULTIPLE of the
 * inherited value instead of a replacement for it.
 *
 * Measured in a browser against a host reset, page setting `20px` and block
 * value `18px`: in `rem` the `h1` was 36px under both, ignoring each author
 * value; in `em`, 45px and 40.5px. With nothing authored the two agree at 36px.
 *
 * The cascade itself is not observable here — jsdom resolves no stylesheet — so
 * this pins the mechanism and `e2e/tests/inline-rich-text.spec.ts` renders the
 * outcome.
 *
 * @module blocks/__tests__/typography-defaults
 */
import { describe, expect, it } from "vitest";

import {
  TYPOGRAPHY_DEFAULTS,
  withTypographyDefaults,
} from "./typography-defaults";

/** The declared value of one property in an element's base state. */
function base(
  tag: keyof typeof TYPOGRAPHY_DEFAULTS,
  property: string
): unknown {
  return TYPOGRAPHY_DEFAULTS[tag]?.base?.base?.[property];
}

describe("the typographic baseline", () => {
  it("sizes every heading in `em`, so an authored ancestor scales it", () => {
    const headings = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
    // Population first: a loop over a mistyped list asserts nothing.
    expect(headings.every(tag => tag in TYPOGRAPHY_DEFAULTS)).toBe(true);

    for (const tag of headings) {
      const size = base(tag, "fontSize");
      expect(typeof size, `${tag} declares no size`).toBe("string");
      // `rem` is the trap rather than a neighbouring choice: it reads as
      // "relative" and resolves against the ROOT, so it ignores every authored
      // value between the root and the heading.
      expect(String(size).endsWith("em")).toBe(true);
      expect(String(size).endsWith("rem")).toBe(false);
    }
  });

  it("gives a paragraph rhythm without a size, so body text stays the reader's", () => {
    // The control on the case above: if every element carried a size, the
    // baseline would be picking a body size for the whole site rather than a
    // scale for its headings.
    expect(base("p", "fontSize")).toBeUndefined();
    expect(base("p", "lineHeight")).toBe(1.6);
  });

  it("leaves a context that states its own bases alone", () => {
    const stated = { breakpoints: [], elementBases: {} } as const;
    expect(withTypographyDefaults(stated).elementBases).toBe(
      stated.elementBases
    );
    // ...and supplies them when the caller has no opinion.
    expect(withTypographyDefaults({ breakpoints: [] }).elementBases).toBe(
      TYPOGRAPHY_DEFAULTS
    );
  });
});
