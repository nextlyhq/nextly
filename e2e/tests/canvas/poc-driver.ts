/**
 * Driver #1: the acceptance suite against the page-builder canvas as it exists
 * today. Every selector here was confirmed against a live canvas, not read off
 * the source.
 */
import { expect, type Frame, type Page } from "@playwright/test";

import { gotoAdmin } from "../support/admin";

import {
  frameContentOrigin,
  mapFramePointToHost,
  mapFrameRectToHost,
  type FrameInset,
} from "./coordinate-mapping";
import { CanvasCapabilityError } from "./driver";
import type {
  ActiveTargetReader,
  CanvasChromeReader,
  CanvasDriver,
  CanvasFixture,
  Point,
  Rect,
} from "./driver";

/**
 * What the in-page recorder stores per sample.
 *
 * Wider than the transition the driver returns: the recorder also carries the
 * two counts the single-shot readers use to reject an ambiguous canvas, so the
 * same invariants can be enforced after the fact rather than only at the
 * moment of a read.
 */
interface RecordedTransition {
  at: number;
  index: number;
  activeCount: number;
  outOfModelCount: number;
}

/**
 * Both drop-zone shapes. `nx-pb-dropzone-empty` does NOT carry
 * `nx-pb-dropzone`, and a class selector matches whole tokens, so querying only
 * the first makes every empty-container target invisible to the suite.
 */
const DROP_ZONES = ".nx-pb-dropzone, .nx-pb-dropzone-empty";

/**
 * Block-level insertion targets. A grid registers insert-before and append
 * droppables on the block element itself and signals them with these classes
 * rather than with `data-active` on a separate zone element, so they are a
 * different SHAPE of target, not another zone.
 *
 * They are out of this driver's ordinal model, which counts gap zones. Rather
 * than report -1 while such a target is visibly active, the readers below
 * throw: a silent -1 would let a scenario conclude "no target" about a canvas
 * that is showing the user one.
 */
const BLOCK_LEVEL_TARGET = ".nx-pb-drop-before, .nx-pb-drop-append";

/** The active zone, in either shape. */
const ACTIVE_ZONE =
  ".nx-pb-dropzone[data-active], .nx-pb-dropzone-empty[data-active]";

/** The editor shell's root element. */
const EDITOR_ROOT = ".nx-pb-editor";

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

  /**
   * The frame's current transform scale; 1 when untransformed.
   *
   * Reported as measured, including zero. A collapsed frame maps the whole
   * canvas onto a point, and the mapping refuses it — but only if the number
   * reaches the mapping, so this must not substitute a usable-looking value for
   * an unusable one.
   *
   * `|| 1` is what did that: it reads as "default when absent" and also fires
   * on a measured 0. It is not needed for the untransformed case either, since
   * `getComputedStyle` reports `"none"` there and `DOMMatrixReadOnly` parses
   * that to the identity, whose `a` is already 1.
   */
  async function frameScale(): Promise<number> {
    return page.evaluate(() => {
      const frame = document.querySelector("iframe");
      if (!(frame instanceof HTMLElement)) return 1;
      return new DOMMatrixReadOnly(getComputedStyle(frame).transform).a;
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

    async isEditorPresent() {
      return page.evaluate(
        selector => !!document.querySelector(selector),
        EDITOR_ROOT
      );
    },

    async frameScale() {
      return frameScale();
    },

    async frameOrigin() {
      const frame = page.locator("iframe");
      const box = await frame.boundingBox();
      if (!box) throw new Error("canvas iframe has no box");
      // The CONTENT origin, not the border-box corner. `boundingBox()` reports
      // the border box, while every rectangle read inside the frame is relative
      // to the content viewport — so on a frame with any border the two differ
      // by `clientLeft`/`clientTop` and every mapped point lands a couple of
      // pixels out. A canvas that does not reset the browser's default iframe
      // border has that gap from the first render, and it reads as "the
      // indicator feels slightly off" rather than as a fault.
      //
      // Measured here, converted there. `clientLeft` is in the frame's own
      // untransformed pixels while the box is post-transform, so the two cannot
      // be added without the scale, and doing that sum at the call site is what
      // put the same error in two files.
      const inset = await frame.evaluate<FrameInset, HTMLIFrameElement>(el => ({
        left: el.clientLeft,
        top: el.clientTop,
      }));
      return frameContentOrigin(box, inset, await frameScale());
    },

    async readBlockBoxes() {
      // Raw rects, not rounded. The zero-layout-shift check compares two
      // snapshots for exact equality, so rounding makes any movement under half
      // a pixel disappear and lets a real shift read as no shift at all.
      // Fractional geometry is ordinary in a grid or a percentage-width column,
      // which is exactly where a drag is most likely to disturb the layout.
      return canvasFrame().evaluate(() =>
        Array.from(document.querySelectorAll("[data-nx-id]")).map(el => {
          const r = el.getBoundingClientRect();
          return {
            id: el.getAttribute("data-nx-id") ?? "",
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
          };
        })
      );
    },

    async readZoneHeights() {
      // Unrounded for the same reason: a zone that grows from 0 to a fraction
      // of a pixel is still a zone that grew, and rounding reports it as
      // collapsed.
      return canvasFrame().evaluate(
        selector =>
          Array.from(document.querySelectorAll(selector)).map(
            el => el.getBoundingClientRect().height
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
        // Mapped by the shared helper rather than multiplied out here. Written
        // inline this is two numbers scaled and added, which is exactly the
        // shape no import scan can tell from ordinary arithmetic — so it is the
        // one that drifts silently when the mapping is corrected.
        const centre = mapFramePointToHost(
          { x: 0, y: rect.y + rect.height / 2 },
          origin,
          scale
        ).y;
        const distance = Math.abs(pointerY - centre);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      return best;
    },

    async readActiveZoneOwner() {
      return canvasFrame().evaluate(
        ([active, blockLevel]) => {
          const outOfModel = document.querySelectorAll(blockLevel);
          if (outOfModel.length > 0) {
            throw new Error(
              `${outOfModel.length} block-level drop target(s) are active; this driver models gap zones only`
            );
          }
          // Exclusivity is checked in every reader, not only the two that
          // return geometry: this is the sole reader the nested-container test
          // uses, so a stale outer zone active alongside an inner one would
          // otherwise read as clean ownership.
          const zones = document.querySelectorAll(active);
          if (zones.length > 1) {
            throw new Error(
              `${zones.length} drop zones are active at once; exactly one may be`
            );
          }
          const zone = zones[0];
          if (!zone) return null;
          const owner = zone.parentElement?.closest("[data-nx-id]");
          return owner?.getAttribute("data-nx-id") ?? null;
        },
        [ACTIVE_ZONE, BLOCK_LEVEL_TARGET] as const
      );
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
        ([all, active, blockLevel]) => {
          const outOfModel = document.querySelectorAll(blockLevel);
          if (outOfModel.length > 0) {
            throw new Error(
              `${outOfModel.length} block-level drop target(s) are active; this driver models gap zones only`
            );
          }
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
        [DROP_ZONES, ACTIVE_ZONE, BLOCK_LEVEL_TARGET] as const
      );
    },

    async recordActiveTargetTransitions(): Promise<ActiveTargetReader> {
      const frame = canvasFrame();
      await frame.evaluate(
        ([all, active, blockLevel]) => {
          const scope = window as unknown as {
            __nxTargetLog?: RecordedTransition[];
            __nxTargetObserver?: MutationObserver;
          };
          // A previous recording left running would keep appending to its own
          // log and fire on this one's mutations too.
          scope.__nxTargetObserver?.disconnect();

          const sample = (): RecordedTransition => {
            const zones = Array.from(document.querySelectorAll(all));
            const activeIndexes = zones
              .map((el, index) => (el.matches(active) ? index : -1))
              .filter(index => index >= 0);
            return {
              at: 0,
              index: activeIndexes[0] ?? -1,
              activeCount: activeIndexes.length,
              outOfModelCount: document.querySelectorAll(blockLevel).length,
            };
          };

          const started = performance.now();
          const log: RecordedTransition[] = [sample()];
          scope.__nxTargetLog = log;

          const observer = new MutationObserver(() => {
            const next = sample();
            const previous = log[log.length - 1];
            // Only CHANGES are recorded. Every attribute write in the canvas
            // fires this callback, and a log with one entry per mutation would
            // report motion that the drop target never had.
            if (
              previous &&
              previous.index === next.index &&
              previous.activeCount === next.activeCount &&
              previous.outOfModelCount === next.outOfModelCount
            ) {
              return;
            }
            log.push({ ...next, at: performance.now() - started });
          });
          // `childList` as well as the attribute: a zone that is added or
          // removed mid-drag renumbers every ordinal after it, and that is a
          // change of target even though no attribute on a surviving element
          // was touched.
          observer.observe(document.body, {
            attributes: true,
            attributeFilter: ["data-active", "class"],
            childList: true,
            subtree: true,
          });
          scope.__nxTargetObserver = observer;
        },
        [DROP_ZONES, ACTIVE_ZONE, BLOCK_LEVEL_TARGET] as const
      );

      return async () => {
        const log = await frame.evaluate(() => {
          const scope = window as unknown as {
            __nxTargetLog?: RecordedTransition[];
            __nxTargetObserver?: MutationObserver;
          };
          scope.__nxTargetObserver?.disconnect();
          return scope.__nxTargetLog ?? [];
        });

        // The same two invariants the single-shot readers enforce, applied to
        // every recorded sample. Checking only the final state would let a
        // canvas that briefly lit two zones, or that showed a block-level
        // target this driver cannot number, record a clean log.
        for (const entry of log) {
          if (entry.outOfModelCount > 0) {
            throw new Error(
              `${entry.outOfModelCount} block-level drop target(s) were active at ${entry.at}ms; this driver models gap zones only`
            );
          }
          if (entry.activeCount > 1) {
            throw new Error(
              `${entry.activeCount} drop zones were active at once at ${entry.at}ms; exactly one may be`
            );
          }
        }

        return log.map(({ at, index }) => ({ at, index }));
      };
    },

    async readIndicatorRect(): Promise<Rect | null> {
      const inFrame = await canvasFrame().evaluate(
        ([active, blockLevel]) => {
          const outOfModel = document.querySelectorAll(blockLevel);
          if (outOfModel.length > 0) {
            throw new Error(
              `${outOfModel.length} block-level drop target(s) are active; this driver models gap zones only`
            );
          }
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
          const el = all[0];
          const style = getComputedStyle(el);
          // `data-active` alone is not evidence the user can SEE an indicator: a
          // CSS regression that hides it, makes it transparent, or collapses it
          // to nothing still leaves the attribute set and still returns a rect.
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number(style.opacity) === 0
          ) {
            throw new Error(
              `the active drop zone is not visible (display=${style.display}, visibility=${style.visibility}, opacity=${style.opacity})`
            );
          }
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) {
            throw new Error(
              `the active drop zone has no size (${r.width}x${r.height})`
            );
          }
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        },
        [ACTIVE_ZONE, BLOCK_LEVEL_TARGET] as const
      );
      if (!inFrame) return null;

      // The driver's own content origin, not a second reading of the frame's
      // box. `boundingBox()` reports the BORDER box, so building the origin
      // here would place every indicator rectangle `inset * scale` out on any
      // bordered canvas — the same fault, in a third place, which is the sign
      // that no caller should be assembling this at all.
      const origin = await driver.frameOrigin();

      // Read the live transform rather than assume 1. Without this the rect
      // reported under a scaled canvas is wrong by the scale factor, and a
      // geometry assertion against it would fail because the MEASUREMENT is
      // wrong, not because the canvas is.
      const scale = await frameScale();

      return mapFrameRectToHost(inFrame, origin, scale);
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

/**
 * What this canvas can and cannot report about its own chrome.
 *
 * Separate from {@link createPocDriver} because these are the readers the
 * twelve-point acceptance suite needs, and this canvas structurally cannot
 * answer several of them. Each refusal names the reason rather than returning a
 * plausible value: an acceptance test that fails with "this canvas draws its
 * indicator inside the iframe" is a target, and one that fails with `false` is
 * indistinguishable from a broken harness.
 */
export function createPocChromeReader(page: Page): CanvasChromeReader {
  return {
    async readIndicators() {
      // Counted in BOTH documents, because the requirement is one claim: one
      // indicator, drawn in host chrome. A host-scoped count answers "one" for
      // a canvas that also leaves one inside the frame.
      const inHost = await page.locator(DROP_ZONES).count();
      const inFrame = await page
        .frameLocator("iframe")
        .locator(ACTIVE_ZONE)
        .count();
      if (inHost === 0 && inFrame > 0) {
        throw new CanvasCapabilityError(
          `this canvas draws its insertion indicator inside the iframe with ` +
            `CSS (${String(inFrame)} in the frame, none in the host), so there ` +
            `is no host overlay whose count and owner can be reported`
        );
      }
      return { count: inHost, host: "document" as const };
    },

    readsInvalidTarget(): Promise<boolean> {
      throw new CanvasCapabilityError(
        "this canvas shows nothing over an illegal target, so there is no " +
          "invalid state to read; absence of an indicator is not a state"
      );
    },

    canvasScrollTop(): Promise<number> {
      throw new CanvasCapabilityError(
        "this canvas does not autoscroll, so its scroll offset during a drag " +
          "reports nothing about a behaviour it does not have"
      );
    },

    startDragOfBlock(id: string): Promise<void> {
      throw new CanvasCapabilityError(
        `this canvas offers no drag for a block already placed in it, so ` +
          `"${id}" cannot be picked up; only the insert panel is draggable`
      );
    },

    undoDepth(): Promise<number> {
      throw new CanvasCapabilityError(
        "this canvas keeps no undo history, so there is no depth to count"
      );
    },
  };
}
