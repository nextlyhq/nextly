/**
 * The placement panel's stylesheet rules, read from the sheet itself: the
 * line that says where a row's value comes from, and the header's mark.
 *
 * @module instance-inspector-styles.test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const FLAT = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
)
  .replace(/\/\*[\s\S]*?\*\//g, "*/")
  .replace(/\s+/g, " ");

/** The declarations of the one rule written for exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:}|\\*/) ${escaped} \\{`).exec(FLAT);
  if (match === null) throw new Error(`no rule for selector: ${selector}`);
  const start = match.index + match[0].length;
  return FLAT.slice(start, FLAT.indexOf("}", start));
}

describe("where a placement's value comes from", () => {
  it("is a quiet line in sentence case, at least 12px, not a tag in capitals", () => {
    // "INHERITED" at 10px read as an internal term; "From the component" is
    // a fact about the value, said as one.
    const source = ruleBody(".nx-inspector__source");
    expect(source).toContain("font-size: var(--text-xs)");
    expect(source).not.toContain("text-transform: uppercase");
    expect(source).toContain("background: transparent");
  });
});

describe("the placement's header", () => {
  it("draws its mark in the component colour, as Layers draws a placement", () => {
    // Grey, the mark read as any block's; the component colour says this is
    // a placement of a component before the description is read.
    // On the icon itself: the tile's colour does not reach it past the icon's
    // own muted rule.
    expect(
      ruleBody(
        ".nx-inspector[data-instance] .nx-block-card__icon .nx-block-icon"
      )
    ).toContain("color: var(--nx-builder-component)");
    const mark = ruleBody(".nx-inspector[data-instance] .nx-block-card__icon");
    expect(mark).toContain(
      "background: color-mix(in oklch, var(--nx-builder-component) 10%, transparent)"
    );
  });
});
