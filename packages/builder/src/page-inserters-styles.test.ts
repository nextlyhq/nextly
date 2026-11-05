import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Where the "+" between sections stays shown without a pointer near it,
 * asserted against the sheet that shows it.
 *
 * jsdom applies no stylesheet, and the browser the end-to-end suite drives
 * cannot tell the two media queries apart: its touch emulation makes the
 * PRIMARY pointer coarse, which both match. The plausible broken sheet asks
 * `(pointer: coarse)`, which a touchscreen laptop with a mouse as its primary
 * pointer does not match, so a tap there lands on a "+" that is hidden and
 * takes no presses. So the query is held to the sheet.
 *
 * @module page-inserters-styles.test
 */
const CHROME = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
);

/** The body of the media block that holds a rule for `selector`. */
function mediaHolding(selector: string): { query: string; body: string } {
  const at = CHROME.indexOf(`  ${selector} {`);
  if (at === -1) throw new Error(`no nested rule for selector: ${selector}`);
  const open = CHROME.lastIndexOf("@media", at);
  const query = CHROME.slice(open, CHROME.indexOf("{", open)).trim();
  const body = CHROME.slice(at, CHROME.indexOf("}", at));
  return { query, body };
}

describe("the + between sections on a touch screen", () => {
  it("is shown and pressable wherever ANY pointer is coarse", () => {
    const { query, body } = mediaHolding(".nx-page-inserters__add");
    expect(query).toBe("@media (any-pointer: coarse)");
    expect(body).toContain("pointer-events: auto;");
    expect(body).toContain("opacity: 1;");
  });
});
