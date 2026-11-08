import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * How a bound prop's chip is cut where the inspector is narrow, asserted
 * against the sheet that draws it: the source goes first, with an ellipsis,
 * and the field's name stays whole while it fits.
 *
 * jsdom lays nothing out, so a test of the chip's markup passes whatever the
 * sheet says. The plausible broken sheet lets the field shrink beside the
 * source (both cut, the field first, as a shared shrink weights them by
 * width) or clips the source with no ellipsis. Each is held to the
 * declarations that prevent it.
 *
 * @module binding-chip-styles.test
 */
const CHROME = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
);

/** The declarations of one rule, found by its exact selector. */
function ruleBody(selector: string): string {
  const open = CHROME.indexOf(`${selector} {`);
  if (open === -1) throw new Error(`no rule for selector: ${selector}`);
  const start = open + `${selector} {`.length;
  return CHROME.slice(start, CHROME.indexOf("}", start));
}

describe("a bound prop's chip, where the panel is narrow", () => {
  it("keeps the field's name whole, cut only when it alone does not fit", () => {
    const field = ruleBody(".nx-binding-chip__field");
    expect(field).toContain("flex: none;");
    expect(field).toContain("max-inline-size: 100%;");
    expect(field).toContain("text-overflow: ellipsis;");
    expect(field).not.toMatch(/flex-shrink:\s*[1-9]/);
  });

  it("cuts the source first, with an ellipsis", () => {
    const source = ruleBody(".nx-binding-chip__source");
    expect(source).toContain("flex: 0 1 auto;");
    expect(source).toContain("min-inline-size: 0;");
    expect(source).toContain("overflow: hidden;");
    expect(source).toContain("text-overflow: ellipsis;");
  });
});
