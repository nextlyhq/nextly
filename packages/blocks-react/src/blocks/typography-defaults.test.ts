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

  it("gives a paragraph MARGINS only, so an author's typography can reach it", () => {
    // The control on the case above, and the reason `p` carries neither size
    // nor leading. Both INHERIT, and this tier emits a rule on the `p` itself —
    // so either one declared here beats what an author set on a containing
    // block, and `core/rich-text` renders its paragraphs below a styled `div`.
    // The heading scale escaped that with `em`; leading has no equivalent, so
    // it is left out rather than made uncontrollable.
    expect(base("p", "fontSize")).toBeUndefined();
    expect(base("p", "lineHeight")).toBeUndefined();
    // Margins stay, and they are safe for the same reason the others are not:
    // margin does NOT inherit, so declaring one here overrides nothing an
    // author expressed on a container.
    expect(base("p", "margin")).toEqual({ blockStart: "0", blockEnd: "1em" });
  });

  it("keeps a heading's own leading, which is the deliberate asymmetry", () => {
    // Large text needs proportionally tighter leading than body text, so one
    // inherited value cannot serve both. An author changing a heading's leading
    // does it on the heading block — a rule on the same element at a higher
    // weight, which wins.
    expect(base("h1", "lineHeight")).toBe(1.15);
    expect(base("h6", "lineHeight")).toBe(1.5);
  });

  it("leaves a context that states its own bases alone", () => {
    const breakpoints = { viewport: [], container: [] };
    const stated = { breakpoints, elementBases: {} };
    // Identity, not equality: a context that already has an opinion must be
    // handed back holding the SAME record, or a host replacing the baseline is
    // quietly given this one to compile against.
    expect(withTypographyDefaults(stated).elementBases).toBe(
      stated.elementBases
    );
    // ...and supplies them when the caller has no opinion.
    expect(withTypographyDefaults({ breakpoints }).elementBases).toBe(
      TYPOGRAPHY_DEFAULTS
    );
  });
});
