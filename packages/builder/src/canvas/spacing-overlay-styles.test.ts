import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chromeStylesheetSource } from "../styles/chrome-stylesheet";

/**
 * How the spacing overlay keeps a small block readable, asserted against the
 * sheet that draws it: jsdom applies no stylesheet, so the overlay's own tests
 * can only see the markers it sets. The plausible broken sheets are a marker
 * with no rule behind it, and outlines that still paint a fill over the
 * block's own color.
 *
 * @module spacing-overlay-styles.test
 */
const CHROME = chromeStylesheetSource(url =>
  readFileSync(fileURLToPath(url), "utf8")
);

/**
 * The body of the one rule whose whole selector is `selector`. Whitespace is
 * read as one space, since the formatter wraps a long selector across lines.
 */
function ruleExactly(selector: string): string {
  const sheet = CHROME.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((match[1] ?? "").replace(/\s+/g, " ").trim() === selector) {
      return match[2] ?? "";
    }
  }
  throw new Error(`no rule for ${selector}`);
}

describe("the spacing overlay over a small block", () => {
  it("hides a number thinner than its band until the band is pointed at", () => {
    expect(
      ruleExactly(
        ".nx-spacing-overlay__band[data-tight]:not([data-pointed]) .nx-spacing-overlay__value"
      )
    ).toMatch(/visibility:\s*hidden/);
  });

  it("draws the bands of a block that holds no blocks as outlines, with no fill", () => {
    const body = ruleExactly(
      ".nx-spacing-overlay[data-outlines] .nx-spacing-overlay__band::before"
    );
    expect(body).toMatch(/background-color:\s*transparent/);
    expect(body).toMatch(/background-image:\s*none/);
    // An outline in the band's own hue, from the overlay's existing tokens.
    expect(body).toMatch(/box-shadow:\s*inset 0 0 0 1px/);
    expect(body).not.toMatch(/#[\da-f]{3,8}\b|\brgba?\(/i);
  });
});
