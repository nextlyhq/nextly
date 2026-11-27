/**
 * What the block toolbar covers, read when the pointer comes onto it.
 *
 * The toolbar steps aside over a block it covers once that block is the
 * hovered one, but a block the toolbar covers whole can never be hovered: the
 * pointer meets the toolbar first, and the toolbar is chrome. So a pointer
 * coming onto the toolbar from anywhere but the selection looks beneath it
 * and points at the block there, as a move over that block would have. A
 * pointer coming up from the selection is heading for the toolbar's buttons,
 * so it is left on them.
 *
 * @module canvas/toolbar-beneath
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { pathTo } from "../panels/layers/layers";

import { CANVAS_ROOT_CLASS } from "./canvas";
import { nodeIdFromEvent } from "./canvas-addressing";
import { CHROME_ATTRIBUTE } from "./canvas-chrome";
import { isElement } from "./dom-kind";
import { overlaySpaceOf } from "./geometry-dom";
import { useHoveredBlockSetter } from "./hovered-block";

/**
 * The block under a point of the editor's document, looking through the
 * toolbar and the rest of the chrome drawn over the canvas, or `null`.
 */
function blockBeneath(
  bar: HTMLElement,
  point: { readonly x: number; readonly y: number }
): string | null {
  const space = overlaySpaceOf(bar, CANVAS_ROOT_CLASS);
  if (space === null) return null;
  const at = space.pointInCanvas(point);
  for (const hit of space.root.ownerDocument.elementsFromPoint(at.x, at.y)) {
    // In a canvas sharing the editor's document the chrome is in the stack
    // too, the toolbar first among it.
    if (isElement(hit) && hit.closest(`[${CHROME_ATTRIBUTE}]`) !== null) {
      continue;
    }
    return nodeIdFromEvent(hit);
  }
  return null;
}

/** Whether `id` is one of `selectedIds` or inside one of them. */
function withinSelection(
  document: BlockDocument,
  id: string,
  selectedIds: readonly string[]
): boolean {
  return pathTo(document, id).some(node => selectedIds.includes(node.id));
}

/**
 * A `pointerenter` handler for the toolbar that points at the block beneath
 * it, unless the pointer last moved over the selection or a block inside it.
 *
 * Where the pointer came from is read from its own moves, in the editor's
 * document and, over a canvas in a frame, in the frame's: the block under
 * each move, or nothing over the canvas's empty ground or outside it. Moves
 * over the editor's chrome are passed over, since a pointer crossing the gap
 * strip or the bar itself on its way up from the selection is still coming
 * from the selection. The hovered block cannot say this: it is let go both
 * when the pointer reaches the chrome and when it crosses empty ground.
 */
export function useLookBeneath(
  bar: React.RefObject<HTMLElement | null>,
  selectedIds: readonly string[],
  document: BlockDocument,
  frameKey: unknown,
  /**
   * The block the bar is drawn for: the bar is mounted only while one is
   * selected, so the moves are watched again once it is there.
   */
  shownFor: string | null,
  /** Whether the bar is drawn now: one mounted hidden is watched once shown. */
  drawn: boolean
): (event: React.PointerEvent<HTMLElement>) => void {
  const setHovered = useHoveredBlockSetter();
  const last = React.useRef<string | null>(null);
  React.useEffect(() => {
    const element = bar.current;
    if (element === null) return;
    const onMove = (event: PointerEvent): void => {
      const target = event.target;
      if (
        isElement(target) &&
        target.closest(`[${CHROME_ATTRIBUTE}]`) !== null
      ) {
        return;
      }
      last.current = nodeIdFromEvent(target);
    };
    const chrome = element.ownerDocument;
    const frame = overlaySpaceOf(element, CANVAS_ROOT_CLASS)?.frame ?? null;
    const inner = frame?.contentDocument ?? null;
    const both = inner !== null && inner !== chrome;
    chrome.addEventListener("pointermove", onMove, { passive: true });
    if (both) inner.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      chrome.removeEventListener("pointermove", onMove);
      if (both) inner.removeEventListener("pointermove", onMove);
    };
  }, [bar, frameKey, shownFor, drawn]);
  return React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // A finger or a pen lands on what it means to press: a tap on the bar
      // is aimed at the button it lands on, never at a block beneath it.
      // Only a mouse arrives by moving, which says where it came from.
      if (event.pointerType === "touch" || event.pointerType === "pen") {
        return;
      }
      const from = last.current;
      if (from !== null && withinSelection(document, from, selectedIds)) {
        return;
      }
      const beneath = blockBeneath(event.currentTarget, {
        x: event.clientX,
        y: event.clientY,
      });
      if (beneath !== null) setHovered(beneath);
    },
    [document, selectedIds, setHovered]
  );
}
