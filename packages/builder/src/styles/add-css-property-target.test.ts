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

/** The root font size the rem lengths resolve against. */
const ROOT_FONT_SIZE = 16;

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

/** A length in px, from px or rem. */
function pixels(length: string): number {
  const match = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(length);
  if (!match) throw new Error(`not a px or rem length: ${length}`);
  const amount = Number(match[1]);
  return match[2] === "rem" ? amount * ROOT_FONT_SIZE : amount;
}

describe("+ Add CSS property", () => {
  it("is at least 24px tall, its hit area padded rather than its text enlarged", () => {
    const heights = declared(".nx-css-properties__add", "min-block-size");
    expect(
      heights,
      "no min-block-size on .nx-css-properties__add"
    ).not.toHaveLength(0);
    for (const height of heights) {
      expect(pixels(height)).toBeGreaterThanOrEqual(MINIMUM_TARGET);
    }
    // The text keeps the size the panel's other quiet buttons draw.
    expect(declared(".nx-css-properties__add", "font-size")).toEqual([
      "var(--text-xs)",
    ]);
  });
});
