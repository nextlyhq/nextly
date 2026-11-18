/**
 * Where the Add panel's highlighted tile would land, as something to draw.
 *
 * The same geometry a canvas drag draws its drop line from: the place's
 * region, measured, and {@link targetsInRegion}'s line at the place's index,
 * which sits in the middle of the gap after the block before it, across the
 * region, and runs down a row's height in a row. One answer for both, so the
 * line a tile shows is where a drag to the same place would show it.
 *
 * Only the place's own region is measured: its container and the blocks in
 * it, never the page around it.
 *
 * @module insertion-line-geometry
 */
import { findNode, type BlockDocument } from "@nextlyhq/blocks-engine";

import type { OpPosition } from "../op-vocabulary";

import {
  rootRegion,
  slotRegion,
  targetsInRegion,
  type DropRegion,
  type DropTarget,
  type RectSource,
} from "./drop-targets";

/** What the canvas draws for a place. */
export type InsertionMark =
  /**
   * A line at the place, as a drag's drop line, and the block beside it
   * (before it, else after it, else its container), which is what is
   * scrolled into view to show the place.
   */
  | {
      readonly kind: "line";
      readonly target: DropTarget;
      readonly nearId: string | undefined;
    }
  /** An empty container the block goes inside: its outline, not a line. */
  | { readonly kind: "empty"; readonly containerId: string };

/**
 * The region a place is in: the container's slot, or the page's top level,
 * built as a drag builds it. `undefined` when the container is no longer on
 * the page or did not render.
 */
function regionOf(
  document: BlockDocument,
  at: OpPosition,
  rects: RectSource
): DropRegion | undefined {
  if (at.parentId === undefined || at.slot === undefined) {
    return rootRegion(document, rects);
  }
  const parent = findNode(document.nodes, at.parentId);
  return parent === undefined
    ? undefined
    : slotRegion(parent, at.slot, 1, rects);
}

/**
 * What to draw for a block going in at `at`: a line where it will land, or,
 * for an empty container, that container to light up. `undefined` when the
 * place cannot be drawn: its container is gone or drew nothing, or it is the
 * top of an empty page, which the page's own start area already shows.
 */
export function insertionMarkOf(
  document: BlockDocument,
  at: OpPosition,
  rects: RectSource
): InsertionMark | undefined {
  const region = regionOf(document, at, rects);
  if (region === undefined) return undefined;
  if (region.childIds.length === 0) {
    return region.parentId === undefined
      ? undefined
      : { kind: "empty", containerId: region.parentId };
  }
  const target = lineAt(targetsInRegion(region, rects), at.index);
  if (target === undefined) return undefined;
  return {
    kind: "line",
    target,
    nearId:
      region.childIds[at.index - 1] ??
      region.childIds[at.index] ??
      region.parentId,
  };
}

/**
 * The region's line for `index`. A block that rendered nothing has no line of
 * its own and takes no room, so a place beside one is drawn at the next line
 * after it, which is the same gap on screen; where none comes after, at the
 * last line before it.
 */
function lineAt(
  lines: readonly DropTarget[],
  index: number
): DropTarget | undefined {
  return lines.find(line => line.at.index >= index) ?? lines[lines.length - 1];
}
