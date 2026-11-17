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
  axisOfRects,
  ROOT_REGION,
  targetsInRegion,
  type DropRegion,
  type DropTarget,
  type RectSource,
} from "./drop-targets";

/** What the canvas draws for a place. */
export type InsertionMark =
  /** A line at the place, as a drag's drop line. */
  | { readonly kind: "line"; readonly target: DropTarget }
  /** An empty container the block goes inside: its outline, not a line. */
  | { readonly kind: "empty"; readonly containerId: string };

/**
 * The region a place is in: the container's slot, or the page's top level.
 * `undefined` when the container is no longer on the page or did not render.
 */
function regionOf(
  document: BlockDocument,
  at: OpPosition,
  rects: RectSource
): DropRegion | undefined {
  const childRects = (ids: readonly string[]) =>
    ids
      .map(id => rects.rectOf(id))
      .filter((rect): rect is NonNullable<typeof rect> => rect !== undefined);
  if (at.parentId === undefined || at.slot === undefined) {
    const childIds = document.nodes.map(node => node.id);
    return {
      id: ROOT_REGION,
      target: { kind: "root" },
      depth: 0,
      rect: rects.rootRect(),
      axis: axisOfRects(childRects(childIds)),
      childIds,
    };
  }
  const parent = findNode(document.nodes, at.parentId);
  const rect = rects.rectOf(at.parentId);
  if (parent === undefined || rect === undefined) return undefined;
  const childIds = (parent.slots?.[at.slot] ?? []).map(child => child.id);
  return {
    id: `${parent.id}::${at.slot}`,
    target: { kind: "slot", parentType: parent.type, slot: at.slot },
    parentId: parent.id,
    slot: at.slot,
    depth: 1,
    rect,
    axis: axisOfRects(childRects(childIds)),
    childIds,
  };
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
  const target = targetsInRegion(region, rects).find(
    candidate => candidate.at.index === at.index
  );
  return target === undefined ? undefined : { kind: "line", target };
}
