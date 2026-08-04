/**
 * Driver #1: the acceptance suite against the page-builder canvas as it exists
 * today. Every selector here was confirmed against a live canvas, not read off
 * the source.
 */
import { expect, type Frame, type Page } from "@playwright/test";

import type { CanvasDriver, CanvasFixture, Point, Rect } from "./driver";
import { gotoAdmin } from "../support/admin";

/**
 * Both drop-zone shapes. `nx-pb-dropzone-empty` does NOT carry
 * `nx-pb-dropzone`, and a class selector matches whole tokens, so querying only
 * the first makes every empty-container target invisible to the suite.
 */
const DROP_ZONES = ".nx-pb-dropzone, .nx-pb-dropzone-empty";

/** The active zone, in either shape. */
const ACTIVE_ZONE =
  ".nx-pb-dropzone[data-active], .nx-pb-dropzone-empty[data-active]";

/** A library entry in the left panel; the drag source for a cross-frame drag. */
const LIBRARY_ITEM = ".nx-pb-lib-item";

/** Past dnd-kit's activation distance in one move, so a drag actually starts. */
const DRAG_THRESHOLD_PX = 12;

export function createPocDriver(page: Page): CanvasDriver {
  /** The canvas iframe is srcless, so it is the about:blank child frame. */
  function canvasFrame(): Frame {
    const frame = page
      .frames()
      .find(
        f => f.parentFrame() === page.mainFrame() && f.url() === "about:blank"
      );
    if (!frame) {
      throw new Error(
        `canvas frame not found; frames: ${page
          .frames()
          .map(f => f.url())
          .join(", ")}`
      );
    }
    return frame;
  }

  let pointer: Point = { x: 0, y: 0 };

  const driver: CanvasDriver = {
    async mountTree(fixture: CanvasFixture) {
      await gotoAdmin(page, `/collections/pages/${fixture.entryId}`);
      await expect(page.locator("iframe")).toBeVisible({ timeout: 30_000 });
      // Poll rather than wait a fixed time: the canvas portals in after the
      // entry form resolves, and the delay is machine-dependent.
      await expect
        .poll(async () => (await driver.readTreeShape()).length, {
          timeout: 30_000,
        })
        .toBe(fixture.blockIds.length);
    },

    async startDragAt(point: Point) {
      pointer = { ...point };
      await page.mouse.move(pointer.x, pointer.y);
      await page.mouse.down();
      pointer = { x: pointer.x + DRAG_THRESHOLD_PX, y: pointer.y };
      await page.mouse.move(pointer.x, pointer.y);
    },

    async moveBy(dx: number, dy: number) {
      pointer = { x: pointer.x + dx, y: pointer.y + dy };
      await page.mouse.move(pointer.x, pointer.y);
    },

    async drop() {
      await page.mouse.up();
    },

    async cancel() {
      await page.keyboard.press("Escape");
      await page.mouse.up();
    },

    async moveToZone(ordinal: number) {
      const inFrame = await canvasFrame().evaluate(
        ([selector, index]) => {
          const zones = Array.from(
            document.querySelectorAll(selector as string)
          );
          const el = zones[index as number];
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        },
        [DROP_ZONES, ordinal] as const
      );
      if (!inFrame) return false;

      const origin = await page.locator("iframe").boundingBox();
      if (!origin) return false;

      // The one mapping: frame-local point + frame origin in the host. No zoom
      // term, because nothing here scales the frame; scenario 3 is what proves
      // whether a scale factor belongs in this function.
      pointer = { x: origin.x + inFrame.x, y: origin.y + inFrame.y };
      await page.mouse.move(pointer.x, pointer.y);
      return true;
    },

    async keyboardInsert(direction: "up" | "down") {
      await page.keyboard.press(direction === "up" ? "ArrowUp" : "ArrowDown");
    },

    async readActiveTarget() {
      return canvasFrame().evaluate(
        ([all, active]) => {
          const zones = Array.from(document.querySelectorAll(all));
          return zones.findIndex(el => el.matches(active));
        },
        [DROP_ZONES, ACTIVE_ZONE] as const
      );
    },

    async readIndicatorRect(): Promise<Rect | null> {
      const inFrame = await canvasFrame().evaluate(active => {
        const el = document.querySelector(active);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }, ACTIVE_ZONE);
      if (!inFrame) return null;

      const frameOrigin = await page.locator("iframe").boundingBox();
      if (!frameOrigin) return null;
      return {
        x: inFrame.x + frameOrigin.x,
        y: inFrame.y + frameOrigin.y,
        width: inFrame.width,
        height: inFrame.height,
      };
    },

    async readTreeShape() {
      return canvasFrame().evaluate(() =>
        Array.from(document.querySelectorAll("[data-nx-id]")).map(
          el => el.getAttribute("data-nx-id") ?? ""
        )
      );
    },

    async scrollHost(dy: number) {
      await page.evaluate(delta => {
        // The admin scrolls an inner element, not the document, so scroll
        // whichever ancestor of the canvas actually overflows.
        const frame = document.querySelector("iframe");
        let node: HTMLElement | null = frame?.parentElement ?? null;
        while (node) {
          if (node.scrollHeight > node.clientHeight) {
            node.scrollTop += delta;
            return;
          }
          node = node.parentElement;
        }
        window.scrollBy(0, delta);
      }, dy);
    },

    async setZoom(scale: number) {
      await page.evaluate(value => {
        const frame = document.querySelector("iframe");
        if (frame instanceof HTMLElement) {
          frame.style.transformOrigin = "top left";
          frame.style.transform = `scale(${value})`;
        }
      }, scale);
    },
  };

  return driver;
}

export { DROP_ZONES, ACTIVE_ZONE, LIBRARY_ITEM };
