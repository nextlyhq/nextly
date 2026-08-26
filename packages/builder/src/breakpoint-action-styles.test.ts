import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The breakpoint actions have styles, which nothing else here can check.
 *
 * A class name in a component and a selector in a stylesheet are two halves of
 * one decision that no type, render test or lint rule connects. The editor's
 * sheet is loaded beside a design system applying Preflight, which strips a
 * bare `<button>` to text — so a missing selector does not throw, does not fail
 * a render assertion, and ships an interactive control an author cannot tell
 * apart from the sentence beside it. Every other gate stays green while it
 * happens, which is why this one exists.
 *
 * Read from the SOURCE stylesheet rather than the built one: `dist` is
 * gitignored, so a check against it answers differently before and after a
 * build, which is the shape that makes CI and a laptop disagree.
 *
 * @module breakpoint-action-styles.test
 */
const CHROME = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
);

describe("the breakpoint actions are styled, not merely marked", () => {
  it("gives the action button a rule of its own", () => {
    expect(CHROME).toContain(".nx-style-inspector__breakpoint-action {");
  });

  it("gives it a hover and a visible focus ring", () => {
    /*
     * Both, because they answer to different people: hover tells a pointer the
     * text is pressable, and a focus ring is the only way a sighted keyboard
     * user locates a control that appears on some fields and not others.
     */
    expect(CHROME).toContain(".nx-style-inspector__breakpoint-action:hover");
    expect(CHROME).toContain(
      ".nx-style-inspector__breakpoint-action:focus-visible"
    );
  });

  it("styles the visible reset fallback beside it", () => {
    expect(CHROME).toContain(".nx-style-inspector__breakpoint-reveals");
  });

  it("finds nothing for a class that was never written", () => {
    /*
     * The control. `toContain` over a 1600-line file is exactly the assertion
     * that passes for the wrong reason if the haystack is wrong or the needle
     * is a substring of something else — so one needle that MUST be absent
     * establishes the search can come out empty.
     */
    expect(CHROME).not.toContain(".nx-style-inspector__breakpoint-nonexistent");
  });
});

describe("the canvas minimum height answers to the canvas scale", () => {
  it("divides the minimum back out by the scale the canvas publishes", () => {
    /*
     * Two halves of one decision that no type or render test connects: the
     * canvas sets `--nx-canvas-scale` in JavaScript, and only this stylesheet
     * consumes it.
     *
     * The minimum exists so the region an author can aim a drop at does not end
     * at the last block — without it, the end of the page has no pixels to
     * point at and a block cannot be dragged there at all. A scaled canvas
     * reintroduces exactly that: laid out at the region's height it PAINTS at a
     * fraction of it, measured at 285px into a 400px region, leaving 115px of
     * region with no canvas on it. Dividing the minimum by the scale is what
     * fills the region again, and it is the case the minimum is needed in most.
     *
     * The FALLBACK is asserted with it, because every unscaled surface — which
     * is all of them until a tier wider than the region is chosen — reads this
     * declaration with the property unset. Without `1` there, the whole minimum
     * becomes invalid and the aiming failure returns everywhere rather than
     * only when zoomed.
     */
    expect(CHROME).toContain(
      "min-height: calc(100% / var(--nx-canvas-scale, 1))"
    );
  });
});
