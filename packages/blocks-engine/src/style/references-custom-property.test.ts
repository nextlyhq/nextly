/**
 * Whether CSS would substitute a custom property in a value.
 *
 * The question this answers is not "does the text contain `var(`". A CSS
 * function token is an identifier immediately followed by `(`, and the
 * identifier is read DECODED — so a spelling nobody would type by hand is a
 * `var()` to a browser and is not one to a reader matching the literal text.
 *
 * These are written as a table of SPELLINGS against one expectation, because
 * every defect in this area is one spelling reaching a reader that only knew
 * another.
 */
import { describe, expect, it } from "vitest";

import {
  checkCssValue,
  customPropertiesReferenced,
  referencesCustomProperty,
} from "./css-value";
import { MAX_VALUE_NESTING } from "./css-value-vocabulary";

describe("a value that CSS would substitute into", () => {
  it.each([
    ["the plain spelling", "var(--brand)"],
    ["a hex-escaped name", "v\\61 r(--brand)"],
    ["an escaped name in capitals", "V\\41 R(--brand)"],
    ["nested inside calc()", "calc(v\\61 r(--x) * 2)"],
    [
      "nested inside a FALLBACK, which arrives as raw text",
      "var(--a, v\\61 r(--b))",
    ],
    ["a shadow whose colour is a reference", "0 1px 2px var(--shadow)"],
  ])("is found: %s", (_label, value) => {
    expect(referencesCustomProperty(value)).toBe(true);
  });

  it.each([
    ["a length", "1rem"],
    ["a hex colour", "#ffffff"],
    ["a function that is not var()", "rgba(0, 0, 0, 0.2)"],
    ["a shadow of plain parts", "0 1px 2px rgba(0,0,0,.2)"],
    ["a font stack", "system-ui, sans-serif"],
  ])("is not found: %s", (_label, value) => {
    expect(referencesCustomProperty(value)).toBe(false);
  });

  it("does not report env(), which resolves the same everywhere", () => {
    /*
     * `env()` substitutes too, and it is deliberately NOT this question. Its
     * values come from the user agent and are identical in a panel and on a
     * canvas, so it cannot produce the disagreement this predicate exists to
     * catch. Asserted rather than left implicit, because "any substitution"
     * is the obvious wrong generalisation of the name.
     */
    expect(referencesCustomProperty("env(safe-area-inset-top)")).toBe(false);
  });

  it.each([")", "var(", "a; b", "@media"])(
    "answers TRUE for %s, which it cannot parse",
    value => {
      /*
       * Fail-closed, and the branch is reachable — these really do fail to
       * parse, which is why they are listed rather than described. A caller is
       * deciding whether to DRAW something; declining to draw a value that
       * would not have rendered costs nothing, and drawing one that substitutes
       * is the defect.
       */
      expect(referencesCustomProperty(value)).toBe(true);
    }
  );

  it("is not satisfied by the raw spelling alone", () => {
    /*
     * The control that names the defect. A regex over the raw text — which is
     * what the tokens panel used — agrees with this predicate on the plain
     * spelling and disagrees on the escaped one. If a future implementation
     * regressed to matching text, this is the case that separates them.
     */
    const raw = (value: string) => /var\s*\(/i.test(value);

    expect(raw("var(--brand)")).toBe(referencesCustomProperty("var(--brand)"));
    expect(raw("v\\61 r(--brand)")).toBe(false);
    expect(referencesCustomProperty("v\\61 r(--brand)")).toBe(true);
  });
});

describe("the custom properties a value reads", () => {
  it.each([
    ["the plain spelling", "var(--site-color-text)", ["--site-color-text"]],
    [
      "a hex-escaped name, read decoded",
      "var(--site-colo\\72)",
      ["--site-color"],
    ],
    ["an escaped function name", "v\\61 r(--brand)", ["--brand"]],
    ["nested inside calc()", "calc(var(--x) * 2)", ["--x"]],
    [
      "nested inside a FALLBACK, which arrives as raw text",
      "var(--a, var(--b))",
      ["--a", "--b"],
    ],
    [
      "each layer of a shadow",
      "0 1px 2px var(--site-ink), inset 0 0 1px var(--site-paper)",
      ["--site-ink", "--site-paper"],
    ],
    ["a name in capitals, kept as written", "var(--Site-Ink)", ["--Site-Ink"]],
    ["no reference at all", "0 1px 2px rgba(0, 0, 0, 0.2)", []],
    ["env(), which is not a custom property", "env(safe-area-inset-top)", []],
  ])("names %s", (_label, value, names) => {
    expect(customPropertiesReferenced(value)).toEqual(names);
  });

  it("names nothing for a var() whose head is not a custom property", () => {
    // The browser drops it, so it reads no variable; it is still a reference
    // to the predicate above, which is the fail-closed question.
    expect(customPropertiesReferenced("var(red)")).toEqual([]);
    expect(referencesCustomProperty("var(red)")).toBe(true);
  });

  it.each([")", "var(", "a; b"])(
    "cannot read %s, which does not parse",
    value => {
      expect(customPropertiesReferenced(value)).toBeUndefined();
    }
  );

  it("reads whole every value the compiler emits, at the nesting bound", () => {
    /*
     * The bound counts the brackets `checkCssValue` counts, so the deepest
     * value it accepts is read whole: the name at the bottom is found. One
     * level deeper is refused there, and read in part here. Both halves are
     * asserted, so a walk bounded by a smaller count (the parse tree's own
     * depth, say, which grows by three for each nested fallback) fails the
     * first.
     */
    const nested = (levels: number) =>
      `${"var(--a, ".repeat(levels - 1)}var(--deep)${")".repeat(levels - 1)}`;
    const deepest = nested(MAX_VALUE_NESTING);
    expect(checkCssValue(deepest)).toBeNull();
    expect(customPropertiesReferenced(deepest)).toContain("--deep");
    const past = nested(MAX_VALUE_NESTING + 1);
    expect(checkCssValue(past)).toBe("too-deeply-nested");
    expect(customPropertiesReferenced(past)).toBeUndefined();
    expect(referencesCustomProperty(past)).toBe(true);
  });
});
