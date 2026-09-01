import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The canvas is drawn on the PAGE's surface, not on the editor's frame.
 *
 * A colour nothing declares is inherited, and inheritance is invisible to every
 * other gate here: the canvas rendered, its blocks rendered, no rule was
 * missing and nothing threw — the page was simply the wrong colour, because the
 * chrome's frame showed through a document whose blocks declare no background
 * of their own. What an author composes then looks nothing like what a visitor
 * loads, which is the one thing this canvas exists to show.
 *
 * Read from the SOURCE stylesheet rather than the built one: `dist` is
 * gitignored, so a check against it answers differently before and after a
 * build — the shape that makes CI and a laptop disagree.
 *
 * @module canvas-surface.test
 */
const CHROME = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
);

/** The one `.nx-canvas` rule, so a second one cannot answer for the first. */
function canvasRule(): string {
  const marker = "\n.nx-canvas {";
  const opened = CHROME.split(marker);
  expect(
    opened.length,
    "exactly one `.nx-canvas` rule, or these assertions read whichever came first"
  ).toBe(2);
  const body = opened[1] as string;
  return body.slice(0, body.indexOf("\n}"));
}

describe("the canvas surface", () => {
  it("declares a background rather than inheriting the frame", () => {
    expect(canvasRule()).toContain("background-color:");
  });

  it("takes it from the RAISED token, not the frame's own", () => {
    /*
     * `--nx-builder-surface` is the frame. Naming it here would declare the
     * inheritance rather than replace it — the same wrong colour, now written
     * down, and a test asserting only that SOME background exists would pass.
     */
    const rule = canvasRule();
    expect(rule).toContain("var(--nx-builder-surface-raised)");
    expect(
      rule.includes("var(--nx-builder-surface)"),
      "the frame's own token would repaint the page in the colour this replaces"
    ).toBe(false);
  });
});
