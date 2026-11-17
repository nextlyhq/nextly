import { APPEAR_LOAD_GATE, APPEAR_SCROLL_GATE } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { CANVAS_ROOT_CLASS } from "../shell-state";

import { CANVAS_FRAME_SHEET } from "./canvas-frame-sheet";

/*
 * The canvas shows every block in its final state: an entrance animation
 * plays on the published page, never while the block is being edited. The
 * browser test watches a block stay still on the canvas; this pins the rule
 * that keeps it so, on both of the page's gates.
 */
describe("the canvas frame's sheet", () => {
  it("closes both of the entrance animation's gates on every page root", () => {
    const rule = new RegExp(
      `\\.${CANVAS_ROOT_CLASS} \\.nx-pb-page \\{\\s*${APPEAR_SCROLL_GATE}: none;\\s*${APPEAR_LOAD_GATE}: none;\\s*\\}`
    );
    expect(CANVAS_FRAME_SHEET).toMatch(rule);
  });
});
