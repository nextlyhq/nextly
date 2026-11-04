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

  it("gives a paragraph no size and no leading, so an author's typography can reach it", () => {
    // Both INHERIT, and this tier emits a rule on the `p` itself — so either
    // one declared here beats what an author set on a containing block, and
    // `core/rich-text` renders its paragraphs below a styled `div`.
    expect(base("p", "fontSize")).toBeUndefined();
    expect(base("p", "lineHeight")).toBeUndefined();
  });

  it("gives every element it covers no outer margin, so a block sits flush", () => {
    // The space between blocks is their container's gap. A margin here leaked
    // out of the block: an `h2` drew 42px above and 14px below, collapsing
    // through a section with no padding and pushing the whole band down.
    // Zero rather than absent, so a host with no reset loses the browser's
    // own heading, paragraph, list, figure and quote margins too.
    const tags = [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "blockquote",
      "hr",
      "ol",
      "ul",
      "pre",
    ] as const;
    for (const tag of tags) {
      expect(base(tag, "margin"), tag).toEqual({
        blockStart: "0",
        blockEnd: "0",
      });
    }
  });

  it("clears a figure's inline margins too, so a captioned image sits as flush as one without", () => {
    // A browser indents a figure by about 40px on each side; an image with
    // no caption is a bare `img` and has no such inset.
    expect(base("figure", "margin")).toEqual({
      blockStart: "0",
      blockEnd: "0",
      inlineStart: "0",
      inlineEnd: "0",
    });
  });

  it("gives every element its own objects, so changing one changes no other", () => {
    // A published, mutable export: a consumer adjusting one entry in place must
    // not move the others with it, which holds exactly when no two entries
    // share an object at any level.
    const entries = Object.values(TYPOGRAPHY_DEFAULTS);
    const values = entries.map(entry => entry?.base?.base);
    const margins = values.map(value => value?.margin);
    // Population: every element has values and a margin to compare.
    expect(entries).toHaveLength(13);
    expect(margins.every(margin => typeof margin === "object")).toBe(true);
    expect(new Set(entries).size).toBe(entries.length);
    expect(new Set(values).size).toBe(values.length);
    expect(new Set(margins).size).toBe(margins.length);
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
