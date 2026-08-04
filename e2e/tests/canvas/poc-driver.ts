/**
 * Driver #1: the acceptance suite against the page-builder canvas as it exists
 * today. Every selector here was confirmed against a live canvas, not read off
 * the source.
 */
import { expect, type Frame, type Page } from "@playwright/test";

import { gotoAdmin } from "../support/admin";

import { mapFrameRectToHost } from "./coordinate-mapping";
import type { CanvasDriver, CanvasFixture, Point, Rect } from "./driver";

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

  /** The frame's current transform scale; 1 when untransformed. */
  async function frameScale(): Promise<number> {
    return page.evaluate(() => {
      const frame = document.querySelector("iframe");
      if (!(frame instanceof HTMLElement)) return 1;
      return new DOMMatrixReadOnly(getComputedStyle(frame).transform).a || 1;
    });
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

    async dragSourceCentre() {
      const box = await page.locator(LIBRARY_ITEM).first().boundingBox();
      if (!box) throw new Error(`no drag source matched ${LIBRARY_ITEM}`);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    },

    async canvasCentre() {
      const box = await page.locator("iframe").boundingBox();
      if (!box) throw new Error("canvas iframe has no box");
      // Near the top rather than the middle: the drag then travels downward
      // through the tree, which is what the sweep scenarios need.
      return { x: box.x + box.width / 2, y: box.y + 40 };
    },

    async clickToInsert() {
      // Scoped to a library item: the first "Insert" in the whole document is
      // not one of these, and clicking it inserts nothing.
      await page
        .locator(LIBRARY_ITEM)
        .first()
        .getByRole("button", { name: "Insert" })
        .click();
    },

    pointer() {
      return { ...pointer };
    },

    async isDragging() {
      // dnd-kit flips aria-grabbed on the source while a drag is active, so the
      // signal is the library's own accessibility state rather than a class the
      // canvas happens to add.
      return page.evaluate(
        () => !!document.querySelector('[aria-grabbed="true"]')
      );
    },

    async frameOrigin() {
      const box = await page.locator("iframe").boundingBox();
      if (!box) throw new Error("canvas iframe has no box");
      return { x: box.x, y: box.y };
    },

    async readBlockBoxes() {
      return canvasFrame().evaluate(() =>
        Array.from(document.querySelectorAll("[data-nx-id]")).map(el => {
          const r = el.getBoundingClientRect();
          return {
            id: el.getAttribute("data-nx-id") ?? "",
            top: Math.round(r.top),
            left: Math.round(r.left),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        })
      );
    },

    async readZoneHeights() {
      return canvasFrame().evaluate(
        selector =>
          Array.from(document.querySelectorAll(selector)).map(el =>
            Math.round(el.getBoundingClientRect().height)
          ),
        DROP_ZONES
      );
    },

    async nearestZoneToPointer() {
      const rects = await canvasFrame().evaluate(
        selector =>
          Array.from(document.querySelectorAll(selector)).map(el => {
            const r = el.getBoundingClientRect();
            return { y: r.y, height: r.height };
          }),
        DROP_ZONES
      );
      if (rects.length === 0) return -1;

      const origin = await driver.frameOrigin();
      const scale = await frameScale();
      const pointerY = pointer.y;

      let best = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      rects.forEach((rect, index) => {
        const centre = origin.y + (rect.y + rect.height / 2) * scale;
        const distance = Math.abs(pointerY - centre);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      return best;
    },

    async readActiveZoneOwner() {
      return canvasFrame().evaluate(active => {
        const zone = document.querySelector(active);
        if (!zone) return null;
        const owner = zone.parentElement?.closest("[data-nx-id]");
        return owner?.getAttribute("data-nx-id") ?? null;
      }, ACTIVE_ZONE);
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
          const el = zones[index];
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
      // A full keyboard drag, not a bare arrow key: focus a block, lift it,
      // move, drop. Sending only the arrow would keep scenario 5 failing for
      // want of an active drag even after keyboard dragging is implemented, so
      // it could never become the unexpected pass it exists to produce.
      const blocks = await driver.readTreeShape();
      const target = blocks[1];
      if (!target) throw new Error("no block available to move");

      await canvasFrame().locator(`[data-nx-id="${target}"]`).focus();
      await page.keyboard.press("Space");
      await page.keyboard.press(direction === "up" ? "ArrowUp" : "ArrowDown");
      await page.keyboard.press("Space");
    },

    async readActiveTarget() {
      return canvasFrame().evaluate(
        ([all, active]) => {
          const zones = Array.from(document.querySelectorAll(all));
          const activeIndexes = zones
            .map((el, index) => (el.matches(active) ? index : -1))
            .filter(index => index >= 0);
          // Exclusivity is checked HERE and not only in `readIndicatorRect`:
          // the oscillation scenarios read ordinals without ever asking for a
          // rectangle, so a stale zone left active alongside the real target
          // would otherwise show up as a perfectly stable ordinal while two
          // insertion indicators were visible on screen.
          if (activeIndexes.length > 1) {
            throw new Error(
              `${activeIndexes.length} drop zones are active at once (${activeIndexes.join(", ")}); exactly one may be`
            );
          }
          return activeIndexes[0] ?? -1;
        },
        [DROP_ZONES, ACTIVE_ZONE] as const
      );
    },

    async readIndicatorRect(): Promise<Rect | null> {
      const inFrame = await canvasFrame().evaluate(active => {
        // All of them, not the first: a collision-state regression that leaves
        // several zones marked active would otherwise be invisible here, and
        // every geometry assertion could pass while stale insertion indicators
        // remained on screen elsewhere.
        const all = document.querySelectorAll(active);
        if (all.length === 0) return null;
        if (all.length > 1) {
          throw new Error(
            `${all.length} drop zones are active at once; exactly one may be`
          );
        }
        const r = all[0].getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }, ACTIVE_ZONE);
      if (!inFrame) return null;

      const frameOrigin = await page.locator("iframe").boundingBox();
      if (!frameOrigin) return null;

      // Read the live transform rather than assume 1. Without this the rect
      // reported under a scaled canvas is wrong by the scale factor, and a
      // geometry assertion against it would fail because the MEASUREMENT is
      // wrong, not because the canvas is.
      const scale = await frameScale();

      return mapFrameRectToHost(
        inFrame,
        { x: frameOrigin.x, y: frameOrigin.y },
        scale
      );
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
