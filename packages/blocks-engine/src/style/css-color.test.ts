import { describe, expect, it } from "vitest";

import { cssColor, hasCssInjection, normalizeCssValue } from "./css-color";

/**
 * A null byte, BUILT rather than written into the source as the byte itself.
 *
 * A fixture that IS the character it tests for is one an editor, a formatter
 * or a commit hook can strip — leaving an ordinary string that goes on
 * passing, for a reason that has nothing to do with the guard.
 */
const NUL = String.fromCharCode(0);

describe("cssColor", () => {
  const ACCEPTED = [
    "#fff",
    "#ffff",
    "#ff0000",
    "#ff0000aa",
    "rgb(255, 0, 0)",
    "rgb(255 0 0)",
    "rgb(255 0 0 / 0.5)",
    "rgba(255, 0, 0, 0.5)",
    "rgba(255 0 0 / 0.5)",
    "hsl(0, 100%, 50%)",
    "hsl(0deg 100% 50%)",
    "hsla(0, 100%, 50%, 0.5)",
    "red",
    "transparent",
  ];

  it.each(ACCEPTED)("keeps %s", value => {
    // The population, stated before any refusal is asserted: a validator that
    // returned `undefined` for everything would satisfy every case below.
    expect(cssColor(value)).toBe(value);
  });

  /*
   * These are refused by the anchored COLOUR SYNTAX, not by the injection
   * guard — measured: deleting the `hasCssInjection` call from `cssColor`
   * leaves every one of them passing. Recorded rather than left to be inferred,
   * because a reader would otherwise take this table as coverage of the guard,
   * and the guard is covered in its own describe below.
   *
   * The guard stays in `cssColor` as the second line rather than as ceremony:
   * every pattern here is anchored `^...$` around digits and a handful of
   * keywords TODAY, and the first permissive syntax added to that list — an
   * `oklch()`, a `color-mix()` — is the one that lets `url(` through.
   */
  it.each([
    ["a declaration break", "red;position:fixed"],
    ["an outbound request", "red;background-image:url(https://example.test/x)"],
    ["a bare url()", "url(https://example.test/x)"],
    ["an IE expression", "expression(alert(1))"],
    ["a custom property", "var(--stolen)"],
    ["an imported sheet", "@import url(https://example.test/s.css)"],
    ["a font request", "@font-face"],
    ["a comment", "red/*x*/"],
    ["an XBL binding", "-moz-binding:url(x)"],
    ["a CSS escape", "\\65 xpression(alert(1))"],
  ])("refuses %s", (_label, value) => {
    expect(cssColor(value)).toBeUndefined();
  });

  it("refuses a value that is not a string, and an empty one", () => {
    expect(cssColor(undefined)).toBeUndefined();
    expect(cssColor(null)).toBeUndefined();
    expect(cssColor(16)).toBeUndefined();
    expect(cssColor("")).toBeUndefined();
  });

  it("refuses a colour carrying a null byte", () => {
    // Asked of the ORIGINAL value. Normalizing strips the byte, so a pattern
    // for it in the injection list could never match and would read as a check
    // while testing nothing.
    expect(cssColor(`re${NUL}d`)).toBeUndefined();
  });

  it("trims, because a stored value carries whatever the editor wrote", () => {
    expect(cssColor("  #fff  ")).toBe("#fff");
  });
});

describe("hasCssInjection", () => {
  it("refuses a backslash however many values came before it", () => {
    /*
     * The regression that motivates the whole list being non-global.
     * `RegExp.prototype.test` on a `g` pattern resumes from `lastIndex` and
     * updates it, so one shared pattern object carries state between unrelated
     * calls: the long value below leaves `lastIndex` at 2, and the short one
     * after it is then searched from position 2 and reported CLEAN.
     *
     * That is a real bypass rather than a tidiness point — the backslash guard
     * exists because `\65 xpression` is `expression` to a browser, so whether
     * it holds must not depend on what was validated a moment earlier.
     *
     * The order matters and so does the repetition: a single call passes
     * whether or not the flag is there.
     */
    expect(hasCssInjection("a\\b\\c")).toBe(true);
    expect(hasCssInjection("\\x")).toBe(true);
    expect(hasCssInjection("\\x")).toBe(true);
  });

  it.each([
    ["a bare url()", "url(https://example.test/x)"],
    ["an IE expression", "expression(alert(1))"],
    ["a custom property", "var(--stolen)"],
    ["an imported sheet", "@import url(https://example.test/s.css)"],
    ["a font request", "@font-face"],
    ["a comment", "red/*x*/"],
    ["an XBL binding", "-moz-binding:url(x)"],
    ["a CSS escape", "\\65 xpression(alert(1))"],
    ["a behavior property", "behavior:url(x.htc)"],
  ])("catches %s", (_label, value) => {
    // The guard on its OWN, because this is the surface where it is the only
    // protection: the CMS asks it about whole inline style declarations, where
    // no colour syntax narrows the input first.
    expect(hasCssInjection(value)).toBe(true);
  });

  it("stays silent on an ordinary value", () => {
    // The negative half. Without it, a guard that answered `true` to everything
    // would satisfy every assertion above.
    expect(hasCssInjection("#ff0000")).toBe(false);
    expect(hasCssInjection("rgb(255, 0, 0)")).toBe(false);
  });

  it("treats a non-string as unsafe rather than as absent", () => {
    expect(hasCssInjection(undefined as unknown as string)).toBe(true);
  });
});

describe("normalizeCssValue", () => {
  it("flattens what a stored value can carry around a declaration", () => {
    expect(normalizeCssValue("  color :\tred\n ")).toBe("color : red");
  });

  it("removes a null byte rather than leaving it to a downstream reader", () => {
    expect(normalizeCssValue(`re${NUL}d`)).toBe("red");
  });
});
