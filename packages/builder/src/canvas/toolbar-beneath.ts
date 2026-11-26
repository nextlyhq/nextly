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
import { useHoveredBlock, useHoveredBlockSetter } from "./hovered-block";

/**
 * The block under a point of the editor's document, looking through the
 * toolbar and the rest of the chrome drawn over the canvas, or `null`.
 */
export function blockBeneath(
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
 * it, unless the pointer last pointed at the selection or a block inside it.
 */
export function useLookBeneath(
  selectedIds: readonly string[],
  document: BlockDocument
): (event: React.PointerEvent<HTMLElement>) => void {
  const hovered = useHoveredBlock();
  const setHovered = useHoveredBlockSetter();
  // The last block pointed at, kept past the moment the toolbar lets it go:
  // where the pointer came from is the one thing that tells an author heading
  // for a button from one aiming at the block beneath it.
  const last = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (hovered !== null) last.current = hovered;
  }, [hovered]);
  return React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
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
