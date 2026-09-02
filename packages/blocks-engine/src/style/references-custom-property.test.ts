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

import { referencesCustomProperty } from "./css-value";

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
