import { APPEAR_LOAD_GATE, APPEAR_SCROLL_GATE } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { CANVAS_ROOT_CLASS } from "../shell-state";

import { APPEAR_PLAYING_ATTRIBUTE } from "./appear-replay";
import { DEVICE_HIDDEN_ATTRIBUTE } from "./canvas-device-hidden";
import { CANVAS_FRAME_SHEET } from "./canvas-frame-sheet";

/** The rule in the sheet for `selector`, its declarations as one string. */
function ruleFor(selector: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(
    CANVAS_FRAME_SHEET
  )?.[1];
}

const PLAYING = `.${CANVAS_ROOT_CLASS} .nx-pb-page [${APPEAR_PLAYING_ATTRIBUTE}]`;

/*
 * The canvas shows every block in its final state: an entrance animation
 * plays on the published page, and on the canvas only for the one block
 * played. The browser test watches a block stay still and play once; this
 * pins the rules that make it so, on both of the page's gates.
 */
describe("the canvas frame's sheet", () => {
  it("closes both of the entrance animation's gates on every page root", () => {
    const rule = new RegExp(
      `\\.${CANVAS_ROOT_CLASS} \\.nx-pb-page \\{\\s*${APPEAR_SCROLL_GATE}: none;\\s*${APPEAR_LOAD_GATE}: none;\\s*\\}`
    );
    expect(CANVAS_FRAME_SHEET).toMatch(rule);
  });

  it("opens both gates on a block played, running it by time", () => {
    const rule = ruleFor(PLAYING);
    expect(rule).toContain(`${APPEAR_SCROLL_GATE}: initial;`);
    expect(rule).toContain(`${APPEAR_LOAD_GATE}: initial;`);
    // A view timeline would leave a block already in view at its end.
    expect(rule).toContain("animation-timeline: auto !important;");
  });

  it("keeps every block inside a played one still", () => {
    const rule = ruleFor(`${PLAYING} :not([${APPEAR_PLAYING_ATTRIBUTE}])`);
    expect(rule).toContain(`${APPEAR_SCROLL_GATE}: none;`);
    expect(rule).toContain(`${APPEAR_LOAD_GATE}: none;`);
  });
});

/*
 * A block hidden on the device shown is drawn striped over, edged, and tagged
 * with its own mark's words, in light and dark values from the page's scheme.
 * The browser test sees the stripe at each device; this pins the rules.
 */
describe("a block hidden on the device shown", () => {
  const HIDDEN = `.${CANVAS_ROOT_CLASS} [${DEVICE_HIDDEN_ATTRIBUTE}]`;

  it("is edged, its stripe, edge and ink mixed from the page's own scheme", () => {
    const rule = ruleFor(HIDDEN) ?? "";
    // Canvas and CanvasText are the scheme's own light or dark ground and
    // text, so each value has a light and a dark one with no admin token.
    for (const token of [
      "--nx-canvas-hidden-band",
      "--nx-canvas-hidden-band-alt",
      "--nx-canvas-hidden-edge",
      "--nx-canvas-hidden-ink",
    ]) {
      const value = new RegExp(`${token}: ([^;]+);`).exec(rule)?.[1];
      expect(value, token).toMatch(/^color-mix\(/);
      expect(value, token).toMatch(/\bCanvas\b/);
    }
    expect(rule).toContain("outline: 1px dashed var(--nx-canvas-hidden-edge)");
  });

  it("is striped over its whole box, tagged with its mark, pressed through", () => {
    const rule = ruleFor(`${HIDDEN}::after`);
    expect(rule).toContain(`content: attr(${DEVICE_HIDDEN_ATTRIBUTE})`);
    expect(rule).toContain("inset: 0");
    expect(rule).toContain("repeating-linear-gradient(");
    expect(rule).toContain("pointer-events: none");
  });

  it("holds the stripes in the block, at no weight over its own position", () => {
    expect(ruleFor(`:where(${HIDDEN})`)).toContain("position: relative");
  });
});
