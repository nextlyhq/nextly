/**
 * The page builder's canvas frame, as a spec finds it.
 *
 * The editor draws the page in an iframe of its own, named "Page canvas: …"
 * after the page, so the blocks are in the FRAME's document while the editor's
 * chrome — the toolbar, the selection marks, the panels — stays in the
 * admin's. A spec looking for a block on the page finds nothing, and an
 * assertion that a block is absent passes for the wrong reason: every block
 * query goes through the frame.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 *
 * @module tests/support/canvas-frame
 */
import type { FrameLocator, Locator, Page } from "@playwright/test";

/** The frame the canvas renders in, by the title the editor gives it. */
export const CANVAS_FRAME = 'iframe[title^="Page canvas"]';

/** The canvas frame's document, to look for blocks in. */
export function canvasFrame(page: Page): FrameLocator {
  return page.frameLocator(CANVAS_FRAME);
}

/** One block on the canvas, by its document id. */
export function canvasBlock(page: Page, id: string): Locator {
  return canvasFrame(page).locator(`.nx-canvas [data-nx-node="${id}"]`);
}

/**
 * The layer the editor draws its chrome in, over the frame, in the admin's
 * document.
 */
export function canvasLayer(page: Page): Locator {
  return page.locator("[data-nx-canvas-layer]");
}
