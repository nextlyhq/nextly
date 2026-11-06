import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Where a hidden block's tag is drawn, asserted against the sheet that draws
 * it.
 *
 * The marks only choose a side and an edge, as `data-tag` and
 * `data-tag-edge`; jsdom applies no stylesheet, so a test of the marks passes
 * whatever the sheet says. The plausible broken sheet is one missing a rule,
 * or one whose rule places the tag on the wrong side, and the tag is then cut
 * off by the canvas exactly where the marks chose a side to avoid it. So each
 * choice is held to the declarations that carry it out.
 *
 * @module hidden-tag-styles.test
 */
const CHROME = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
);

const TAG = '.nx-canvas-mark[data-mark="selected"][data-hidden]';

/** The declarations of one rule, found by its exact selector. */
function ruleBody(selector: string): string {
  const open = CHROME.indexOf(`${selector} {`);
  if (open === -1) throw new Error(`no rule for selector: ${selector}`);
  const start = open + `${selector} {`.length;
  return CHROME.slice(start, CHROME.indexOf("}", start));
}

describe("a hidden block's tag", () => {
  it("is drawn below the ring at its right edge by default, inset from a cut edge", () => {
    const tag = ruleBody(`${TAG}::after`);
    expect(tag).toContain("content: attr(data-label);");
    expect(tag).toContain("position: absolute;");
    expect(tag).toContain("top: calc(100% + 4px);");
    // Moved in by as far as the ring runs past the screen's right edge.
    expect(tag).toContain("right: var(--nx-tag-inset-side, 0);");
  });

  it("is drawn above the ring for data-tag=above", () => {
    const above = ruleBody(`${TAG}[data-tag="above"]::after`);
    expect(above).toContain("top: auto;");
    expect(above).toContain("bottom: calc(100% + 4px);");
  });

  it("lines up with the ring's left edge for data-tag-edge=left", () => {
    const left = ruleBody(`${TAG}[data-tag-edge="left"]::after`);
    expect(left).toContain("right: auto;");
    expect(left).toContain("left: var(--nx-tag-inset-side, 0);");
  });

  it("is drawn inside the ring, at the insets the marks set, for data-tag=inside", () => {
    const inside = ruleBody(`${TAG}[data-tag="inside"]::after`);
    expect(inside).toContain("top: auto;");
    expect(inside).toContain("bottom: var(--nx-tag-inset-bottom, 4px);");
    expect(inside).toContain("right: var(--nx-tag-inset-side, 4px);");
    const insideLeft = ruleBody(
      `${TAG}[data-tag="inside"][data-tag-edge="left"]::after`
    );
    expect(insideLeft).toContain("right: auto;");
    expect(insideLeft).toContain("left: var(--nx-tag-inset-side, 4px);");
  });

  it("keeps the inside rules after the edge rule, so they win where both match", () => {
    // Same specificity for `inside` and `edge=left` alone, so source order
    // decides: an inside tag must not take the outside edge rule's `left: 0`.
    expect(CHROME.indexOf(`${TAG}[data-tag="inside"]::after`)).toBeGreaterThan(
      CHROME.indexOf(`${TAG}[data-tag-edge="left"]::after`)
    );
  });
});
