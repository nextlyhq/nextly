/**
 * How the site CSS is cut into the parts its rows hold: at most 255 Unicode
 * characters (code points) each, as MySQL's `varchar(255)` counts them, so a
 * character outside the Basic Multilingual Plane counts once and is never cut
 * in two, and the parts join back to exactly what was saved.
 *
 * @module site-code/site-css-store.test
 */
import { describe, expect, it } from "vitest";

import { SITE_CSS_PART_CHARS, siteCssParts } from "./site-css-store";

/** The code points in `text`. */
const codePoints = (text: string): number => Array.from(text).length;

describe("siteCssParts", () => {
  it("holds nothing for no CSS", () => {
    expect(siteCssParts("")).toEqual([]);
  });

  it("fills each part with 255 characters, counting a non-BMP character once", () => {
    // 300 characters, every one of them two UTF-16 units: a split by units
    // would fill a part with 127 of them, half what a part may hold.
    const css = "😀".repeat(300);
    const parts = siteCssParts(css);
    expect(parts.map(codePoints)).toEqual([SITE_CSS_PART_CHARS, 45]);
    expect(parts.join("")).toBe(css);
  });

  it("never cuts a character in two at a part's end", () => {
    const css = `${"a".repeat(254)}😀b`;
    const parts = siteCssParts(css);
    expect(parts).toEqual([`${"a".repeat(254)}😀`, "b"]);
    expect(parts.every(part => codePoints(part) <= SITE_CSS_PART_CHARS)).toBe(
      true
    );
  });

  it("joins back to the CSS it was cut from", () => {
    const css = Array.from({ length: 2000 }, (_, i) =>
      i % 7 === 0 ? "𝔸" : String.fromCharCode(97 + (i % 26))
    ).join("");
    expect(siteCssParts(css).join("")).toBe(css);
  });
});
