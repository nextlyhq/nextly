/**
 * "+ Add CSS property" is a target a pointer or a finger can hit: at least
 * 24 by 24 CSS pixels, WCAG 2.2's minimum (2.5.8), which axe's `target-size`
 * rule checks.
 *
 * Drawn as small quiet text with a 2px pad above and below, the button stood
 * about 20px tall. Its hit area is padded to the minimum rather than its text
 * made larger. jsdom lays nothing out, so the size is read from the rules the
 * chrome's stylesheet is built from.
 *
 * The minimum is in CSS pixels, whatever the root font size: a reader who sets
 * a smaller default text size in the browser shrinks every rem length, so a
 * rem floor alone would draw the button under 24px. The height is resolved at
 * several root sizes, not only the usual 16px.
 *
 * @module add-css-property-target.test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chromeStylesheetSource } from "./chrome-stylesheet";

// Comments dropped, so a rule's prose never answers for its declarations.
const FLAT = chromeStylesheetSource(url =>
  readFileSync(fileURLToPath(url), "utf8")
)
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\s+/g, " ");

/** WCAG 2.2's minimum target, in CSS pixels. */
const MINIMUM_TARGET = 24;

/**
 * Root font sizes a reader's browser can set: smaller and larger than the
 * usual 16px.
 */
const ROOT_FONT_SIZES = [10, 12, 16, 20];

/**
 * Every declaration of `property` in a rule whose selector list names
 * `selector` itself, not one of its states.
 */
function declared(selector: string, property: string): string[] {
  const values: string[] = [];
  for (const [, selectors = "", body = ""] of FLAT.matchAll(
    /([^{}]+)\{([^{}]*)\}/g
  )) {
    const names = selectors.split(",").map(name => name.trim());
    if (!names.includes(selector)) continue;
    for (const [, value = ""] of body.matchAll(
      new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "g")
    )) {
      values.push(value.trim());
    }
  }
  return values;
}

/** A length in px at a root font size: px, rem, or a `max()` of them. */
function pixels(length: string, rootFontSize: number): number {
  const larger = /^max\((.+)\)$/.exec(length);
  if (larger) {
    return Math.max(
      ...(larger[1] ?? "")
        .split(",")
        .map(part => pixels(part.trim(), rootFontSize))
    );
  }
  const match = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(length);
  if (!match) throw new Error(`not a px, rem or max() length: ${length}`);
  const amount = Number(match[1]);
  return match[2] === "rem" ? amount * rootFontSize : amount;
}

describe("+ Add CSS property", () => {
  it("is at least 24px tall at any root font size, its hit area padded rather than its text enlarged", () => {
    const heights = declared(".nx-css-properties__add", "min-block-size");
    expect(
      heights,
      "no min-block-size on .nx-css-properties__add"
    ).not.toHaveLength(0);
    for (const height of heights) {
      for (const root of ROOT_FONT_SIZES) {
        expect(
          pixels(height, root),
          `min-block-size: ${height} with a ${root}px root`
        ).toBeGreaterThanOrEqual(MINIMUM_TARGET);
      }
    }
    // The text keeps the size the panel's other quiet buttons draw.
    expect(declared(".nx-css-properties__add", "font-size")).toEqual([
      "var(--text-xs)",
    ]);
  });
});
