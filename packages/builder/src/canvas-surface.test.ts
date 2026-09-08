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

describe("the canvas as a sheet", () => {
  it("states its own edge, so the page is separable at any tone", () => {
    /*
     * The frame is deliberately one step off the background so it recedes, so
     * the two surfaces alone are close by design. The edge is what makes the
     * page separable regardless — and regardless of which of the two is
     * lighter, which the palette inverts between modes.
     */
    expect(canvasRule()).toContain(
      "outline: 1px solid var(--nx-builder-border)"
    );
  });

  it("carries the separation on the EDGE, not only on a shadow", () => {
    /*
     * A shadow has almost nothing to darken on a dark page, so a sheet relying
     * on one is legible in light mode and flat in dark. The shadow may be
     * present as a secondary cue; the edge may not be missing.
     */
    const rule = canvasRule();
    const hasEdge = rule.includes("outline: 1px solid");
    expect(
      hasEdge,
      "a shadow alone leaves the page edgeless wherever it cannot cast"
    ).toBe(true);
  });

  it("draws that edge OUTSIDE the width the page is previewed at", () => {
    /*
     * This element carries the previewed width, `container-type: inline-size`
     * and the edge together, under the shell's `box-sizing: border-box`. A
     * border is therefore subtracted from the content box the container queries
     * resolve against, and two pixels decide a tier: at a 992px request the
     * content box is 990px, so a `max-width: 991px` rule stays active and the
     * unconditional tier cannot be previewed at all. An outline paints outside
     * the box and takes part in no layout, which is why it is the one that may
     * be used here.
     *
     * Matched as a property rather than as the shorthand, so `border-top` or
     * `border-width` cannot reintroduce the same subtraction under another
     * spelling. `--nx-builder-border` is not a match: the token is preceded by
     * `-` rather than by whitespace, and is a value rather than a declaration.
     */
    const declaresBorder = /(?:^|\s)border(?:-[a-z]+)?\s*:/.test(canvasRule());
    expect(
      declaresBorder,
      "a border here narrows the content box the previewed tier is decided by"
    ).toBe(false);
  });
});

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
