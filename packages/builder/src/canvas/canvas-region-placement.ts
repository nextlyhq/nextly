/**
 * Where a header or footer's tag sits on the canvas.
 *
 * Inside the region, always: a mark hanging outside it sat over the page's
 * first or last block, covering its text and taking the pointer from it, so
 * hover flickered along the strip it covered. The tag sits at the region's
 * top left, and drops to its bottom left only where the top left is
 * scrolled off screen and the bottom left is not, so it stays in sight. A
 * region shorter than the tag draws none: the outline marks it alone.
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

/**
 * Which corner inside its region a tag sits in, on its left side, or
 * `"none"` for a region shorter than the tag (a short header far zoomed
 * out), where any corner would put it over the page.
 */
export type RegionMarkPlacement = "top" | "bottom" | "none";

/**
 * Which corner inside its region a tag is drawn in.
 *
 * `edge` is the region's box and `viewport` the height of what is on screen,
 * both in the frame's own pixels; `height` is the tag's, its gap included.
 * The top wherever it shows, or where the bottom shows no better; none
 * where the region is shorter than the tag.
 */
export function regionMarkPlacement(args: {
  readonly edge: { readonly top: number; readonly bottom: number };
  readonly height: number;
  readonly viewport: number;
}): RegionMarkPlacement {
  const { edge, height, viewport } = args;
  if (edge.bottom - edge.top < height) return "none";
  const topShows = edge.top >= 0 && edge.top + height <= viewport;
  const bottomShows =
    edge.bottom - height >= Math.max(edge.top, 0) && edge.bottom <= viewport;
  return topShows || !bottomShows ? "top" : "bottom";
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
