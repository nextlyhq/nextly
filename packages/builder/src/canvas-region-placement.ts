/**
 * Where a Layout region's mark sits on the canvas: its lock, the badge it
 * widens into on hover, and the tag it opens.
 *
 * Never over the region's own content. A header's nav and call to action, a
 * footer's links, are exactly what a corner badge covered, so the mark hangs
 * OUTSIDE the region, from the edge it shares with the page: below a header,
 * above a footer, as the block toolbar sits outside the block it serves. Only
 * where outside has no room on screen, a header whose bottom edge is at the
 * foot of the canvas or a footer whose top edge is at its head, does it flip
 * inside, rather than be drawn where nobody can see it.
 *
 * Across, it starts at the region's left edge and is kept within the part of
 * the frame that is on screen: at 100% a desktop page is wider than the
 * canvas, and a mark pinned to the right edge was off screen until the author
 * scrolled sideways.
 *
 * Pure arithmetic over measured boxes, so both rules are tested without a
 * layout engine.
 *
 * @module canvas-region-placement
 */

/** Where a mark sits against its region's page edge. */
export type RegionMarkPlacement = "outside" | "inside";

/**
 * Which side of its page edge a region's mark is drawn on.
 *
 * `edge` is the region's box and `viewport` the height of what is on screen,
 * both in the frame's own pixels; `height` is the mark's, its gap included.
 * Outside wherever it fits, or where inside fits no better; inside only where
 * that keeps on screen a mark outside would push off it.
 */
export function regionMarkPlacement(args: {
  readonly area: "header" | "footer";
  readonly edge: { readonly top: number; readonly bottom: number };
  readonly height: number;
  readonly viewport: number;
}): RegionMarkPlacement {
  const { area, edge, height, viewport } = args;
  if (area === "header") {
    const fitsOutside = edge.bottom + height <= viewport;
    const fitsInside = edge.top >= 0 && edge.top + height <= viewport;
    return fitsOutside || !fitsInside ? "outside" : "inside";
  }
  const fitsOutside = edge.top - height >= 0;
  const fitsInside = edge.top >= 0 && edge.top + height <= viewport;
  return fitsOutside || !fitsInside ? "outside" : "inside";
}

/** The gap between a region's left edge and its mark, at rest and on screen. */
export const REGION_MARK_INSET = 8;

/**
 * How far from the region's left edge its mark starts, in the frame's
 * pixels: the inset, or further in when the region's left part is scrolled
 * off screen, so the mark starts where the visible part does. Never so far
 * that a mark of `width` would leave the region on the right.
 *
 * `visible` is the span of the frame on screen and `region` the region's own,
 * both in the frame's pixels.
 */
export function regionMarkLeft(args: {
  readonly region: { readonly left: number; readonly right: number };
  readonly visible: { readonly left: number; readonly right: number };
  readonly width: number;
}): number {
  const { region, visible, width } = args;
  const wanted = Math.max(visible.left - region.left, 0) + REGION_MARK_INSET;
  const most = region.right - region.left - width - REGION_MARK_INSET;
  return Math.max(REGION_MARK_INSET, Math.min(wanted, most));
}
