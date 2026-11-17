import { APPEAR_LOAD_GATE, APPEAR_SCROLL_GATE } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { CANVAS_ROOT_CLASS } from "../shell-state";

import { APPEAR_PLAYING_ATTRIBUTE } from "./appear-replay";
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
