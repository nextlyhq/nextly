/**
 * An Entry content block's notes are drawn on the author's page, inside the
 * canvas's frame, so their colours come from the page, as the empty
 * container's do: the muted note and the red one alike stay legible on a
 * light page whichever theme the admin is in. A note drawn on the admin's own
 * surface and scheme is a dark band on a white page in the dark theme.
 */
import { ENTRY_CONTENT_NOTE_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { describe, expect, it } from "vitest";

import { CANVAS_FRAME_SHEET } from "./canvas-frame-sheet";

/** The declarations of the sheet's rule for `selector`, as written. */
function ruleFor(selector: string): string {
  const at = CANVAS_FRAME_SHEET.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const end = CANVAS_FRAME_SHEET.indexOf("}", at);
  return CANVAS_FRAME_SHEET.slice(at, end);
}

describe("an Entry content block's notes on the page", () => {
  const muted = ruleFor(`[${ENTRY_CONTENT_NOTE_ATTRIBUTE}]`);
  const failed = ruleFor(`[${ENTRY_CONTENT_NOTE_ATTRIBUTE}="failed"]`);

  it("draws the muted note in the page's own ink (the control)", () => {
    expect(muted).toContain("currentColor");
    expect(muted).not.toContain("--nx-builder-surface-raised");
  });

  it("draws the red note on the page too, never on the admin's surface or scheme", () => {
    // Its tint over the page, and its words mixed with the page's ink.
    expect(failed).toContain("transparent");
    expect(failed).toContain("currentColor");
    expect(failed).not.toContain("--nx-builder-surface-raised");
    expect(failed).not.toContain("color-scheme");
    expect(failed).not.toContain("--nx-builder-text");
  });
});
