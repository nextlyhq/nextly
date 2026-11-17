/**
 * Where the in-place picker is drawn beside: the control that opened it, or,
 * for "/", the selected block (or the end of the page), measured in the
 * editor's own window even when the page is drawn in a frame.
 *
 * @module insert-picker-anchor
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";

import { nodeElement } from "../../canvas/canvas-addressing";
import {
  boxInFrameViewport,
  framePointInHost,
} from "../../canvas/geometry-dom";
import { isIFrame } from "../../dom-kind";

import { NOWHERE, type Measurable } from "./insert-panel-summon";

/**
 * A control the picker opens from, such as a "+": its own box, read each time
 * the picker is placed, so a scroll moves the picker with it.
 */
export function elementAnchor(element: Element | null): Measurable {
  if (element === null) return NOWHERE;
  return {
    contextElement: element,
    getBoundingClientRect: () => hostBox(element),
  };
}

/**
 * The picker's anchor for "/": the selected block, or, with nothing selected,
 * the bottom edge of the page's last block, where a block will be added. The
 * part on screen is used, so a tall Section scrolled half away still places
 * the picker where the author is looking. `NOWHERE` while the canvas has not
 * drawn the block.
 *
 * @param root - the canvas root the blocks are drawn in
 * @param document - the page, for its last block
 * @param selectedId - the selected block, or `null`
 */
export function selectionAnchor(
  root: HTMLElement | null,
  document: BlockDocument,
  selectedId: string | null
): Measurable {
  if (root === null) return NOWHERE;
  const lastId = document.nodes.at(-1)?.id;
  const id = selectedId ?? lastId;
  const element = id === undefined ? root : (nodeElement(root, id) ?? root);
  const atEnd = selectedId === null && lastId !== undefined;
  return {
    contextElement: element,
    getBoundingClientRect: () => {
      const box = onScreen(hostBox(element), viewportOf(element));
      return atEnd ? new DOMRect(box.x, box.bottom, box.width, 0) : box;
    },
  };
}

/**
 * An element's box in the editor's window, read through the module that
 * reads boxes. Inside the canvas's frame, both corners are mapped out of the
 * frame, which is scaled to fit the well.
 */
function hostBox(element: Element): DOMRect {
  const box = boxInFrameViewport(element);
  const frame = element.ownerDocument.defaultView?.frameElement;
  if (!isIFrame(frame)) return new DOMRect(box.x, box.y, box.width, box.height);
  const start = framePointInHost(frame, { x: box.x, y: box.y });
  const end = framePointInHost(frame, {
    x: box.x + box.width,
    y: box.y + box.height,
  });
  return new DOMRect(start.x, start.y, end.x - start.x, end.y - start.y);
}

/** The editor window's size, for the element's own window or its frame's host. */
function viewportOf(element: Element): { width: number; height: number } {
  const own = element.ownerDocument.defaultView;
  const frame = own?.frameElement;
  const host = isIFrame(frame) ? frame.ownerDocument.defaultView : own;
  return {
    width: host?.innerWidth ?? Number.POSITIVE_INFINITY,
    height: host?.innerHeight ?? Number.POSITIVE_INFINITY,
  };
}

/**
 * The part of a box inside the window, or, for a box wholly off it, a line
 * at the nearest edge, so the picker is placed in view either way.
 */
function onScreen(
  box: DOMRect,
  viewport: { readonly width: number; readonly height: number }
): DOMRect {
  const left = clamp(box.left, 0, viewport.width);
  const right = clamp(box.right, 0, viewport.width);
  const top = clamp(box.top, 0, viewport.height);
  const bottom = clamp(box.bottom, 0, viewport.height);
  return new DOMRect(left, top, right - left, bottom - top);
}

/** A number held between two bounds. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
