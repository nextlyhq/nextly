/**
 * The hidden-block marker's words stay readable however small the canvas
 * paints the page: the frame's sheet sizes them against the canvas zoom, with
 * a floor of 11px on screen, and leaves them at their own 13px at full size.
 *
 * Read from the source sheet, as the other frame-sheet checks are: a rule's
 * text is what the frame is handed, so this holds the rule the marker gets.
 *
 * @module condition-hidden-zoom.test
 */
import { describe, expect, it } from "vitest";

import { CANVAS_FRAME_SHEET } from "./canvas-frame-sheet";
import { CANVAS_ROOT_CLASS } from "./shell-state";

/** The declarations of the one rule a selector opens, whitespace collapsed. */
function ruleBody(selector: string): string | undefined {
  const sheet = CANVAS_FRAME_SHEET.replace(/\s+/g, " ");
  const start = sheet.indexOf(`${selector} {`);
  if (start === -1) return undefined;
  const open = sheet.indexOf("{", start);
  return sheet.slice(open + 1, sheet.indexOf("}", open)).trim();
}

describe("the hidden-block marker at any canvas zoom", () => {
  const body = ruleBody(`.${CANVAS_ROOT_CLASS} .nx-condition-hidden`);

  it("is sized against the canvas zoom, never under 11px on screen, its own 13px at full size", () => {
    expect(body).toBeDefined();
    // max(13px, 11px / zoom): at zoom 1 the first wins; at a Fit of 58% the
    // second, which the zoom then paints at 11px.
    expect(body).toContain(
      "font-size: max(0.8125rem, calc(0.6875rem / var(--nx-canvas-zoom, 1)));"
    );
  });

  it("keeps its shape at every zoom, its spacing in its own text's units", () => {
    expect(body).toMatch(/gap: [\d.]+em;/);
    expect(body).toMatch(/padding: [\d.]+em [\d.]+em;/);
  });
});
