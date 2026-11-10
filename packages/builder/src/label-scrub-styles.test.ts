import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * What a draggable label looks like and which gestures it keeps, asserted
 * against the sheet that decides it: jsdom applies no stylesheet, so a render
 * test passes whatever the sheet says.
 *
 * @module label-scrub-styles.test
 */
const CHROME = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
);

const SELECTOR = ".nx-style-inspector .nx-inspector__field > label[data-scrub]";

/** The declarations of the draggable label's rule. */
function labelRule(): string {
  const open = CHROME.indexOf(`${SELECTOR} {`);
  if (open === -1) throw new Error("no rule for a draggable label");
  const start = open + `${SELECTOR} {`.length;
  return CHROME.slice(start, CHROME.indexOf("}", start));
}

describe("a draggable label", () => {
  it("shows the resize cursor, as a plain declaration", () => {
    // The admin's `[data-slot="label"] { cursor: pointer !important }` does
    // not reach a draggable label, which carries no `data-slot` (the panel
    // test holds that), so nothing here needs to outrank it.
    expect(labelRule()).toMatch(/cursor:\s*ew-resize;/);
  });

  it("is not selected by a drag", () => {
    expect(labelRule()).toMatch(/user-select:\s*none;/);
  });

  it("keeps a pen's horizontal drag for the scrub, and a finger's scroll for the panel", () => {
    expect(labelRule()).toMatch(/touch-action:\s*pan-y;/);
  });
});
