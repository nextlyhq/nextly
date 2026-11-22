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

  it("is edged, the edge mixed from the page's own scheme", () => {
    const rule = ruleFor(HIDDEN) ?? "";
    // Canvas and CanvasText are the scheme's own light or dark ground and
    // text, so the edge has a light and a dark value with no admin token.
    const edge = /--nx-canvas-hidden-edge: ([^;]+);/.exec(rule)?.[1];
    expect(edge).toMatch(/^color-mix\(/);
    expect(edge).toMatch(/\bCanvas\b/);
    expect(rule).toContain("outline: 1px dashed var(--nx-canvas-hidden-edge)");
  });

  it("draws nothing inside the block, and moves nothing it holds", () => {
    // The stripes and the tag are the editor's marks over the canvas. An
    // overlay inside the block would need the block to hold it (a position,
    // a transform, will-change), which moves what its fixed or absolutely
    // placed blocks are laid out against.
    const rule = ruleFor(HIDDEN) ?? "";
    // CONTROL: the rule read is the hidden block's own.
    expect(rule).toContain("outline:");
    expect(rule).not.toMatch(
      /(^|[\s;{])(position|will-change|transform|contain|filter):/
    );
    expect(CANVAS_FRAME_SHEET).not.toContain(`${HIDDEN}::after`);
    expect(CANVAS_FRAME_SHEET).not.toContain(`${HIDDEN}::before`);
    expect(ruleFor(`:where(${HIDDEN})`)).toBeUndefined();
  });
});
