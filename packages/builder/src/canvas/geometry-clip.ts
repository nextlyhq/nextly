/**
 * Whether a clipping ancestor cuts a block, decided from what `geometry-dom.ts`
 * has already read.
 *
 * `clippedByAncestor`, `clippedByAncestorRect` and `visiblePartOf` there read
 * the block's rectangle and each ancestor's. The rest of the question lives
 * here: which computed displays clip at all, the walk over the ancestors, the
 * shape of one ancestor's clip, and the edge and corner comparisons against it.
 * Nothing here reads a rectangle, so a measurement still enters this package
 * through `geometry-dom.ts` alone, which `geometry-ownership.test.ts` holds.
 *
 * @module geometry-clip
 */

import type { Scale } from "../geometry";

import type { CornerRadii, EdgeBounds } from "./border-radii";
import {
  insetCornerRadii,
  isSquare,
  roundedInsideRounded,
  scaleCornerRadii,
  usedCornerRadii,
} from "./border-radii";
import { edgeWidth, type RenderedScale } from "./geometry-transform";

/**
 * Computed `display` values whose generated box `overflow` does not clip.
 *
 * MEASURED across the catalog's display set in Chromium rather than read off a
 * spec table, by giving each value `overflow: hidden` and a child pulled outside
 * it, then reading the pixels. The list is wider than the inline box people
 * reach for first, and two of the entries are not guessable:
 *
 * - The internal TABLE boxes take no clip — a row, a row group, a header group
 *   and a footer group all paint a child straight through the edge — while
 *   `table`, `inline-table` and `table-cell` all clip normally.
 * - `contents` generates no box at all, so nothing clips AND
 *   `getBoundingClientRect` answers 0x0 on it. A caller that skipped this entry
 *   would compare a descendant against a zero-sized rectangle and conclude every
 *   block is outside it.
 *
 * `ruby-base`, `ruby-base-container` and `ruby-text-container` are deliberately
 * ABSENT: all three compute to plain `block` in Chromium, so they clip and an
 * entry for them would describe a value that never arrives.
 *
 * The measurement had to force overflow with a NEGATIVE MARGIN rather than an
 * oversized child, because table boxes size to their content: a wide child makes
 * them grow to fit, and "not clipped" then means "never overflowed" — which read
 * as six false entries on the first pass.
 */
const OVERFLOW_NEVER_CLIPS: ReadonlySet<string> = new Set([
  "inline",
  "inline list-item",
  "table-row",
  "table-row-group",
  "table-header-group",
  "table-footer-group",
  "ruby",
  "ruby-text",
  "contents",
]);

/** Whether `overflow` establishes a clip on a box with this computed display. */
export function overflowApplies(display: string): boolean {
  return !OVERFLOW_NEVER_CLIPS.has(display);
}

/** Cut `edges` to one ancestor's clip, on each axis the ancestor clips. */
export function narrowTo(
  edges: { left: number; top: number; right: number; bottom: number },
  context: { clipsX: boolean; clipsY: boolean; clip: EdgeBounds }
): void {
  if (context.clipsX) {
    edges.left = Math.max(edges.left, context.clip.left);
    edges.right = Math.min(edges.right, context.clip.right);
  }
  if (context.clipsY) {
    edges.top = Math.max(edges.top, context.clip.top);
    edges.bottom = Math.min(edges.bottom, context.clip.bottom);
  }
}

/**
 * Walks the ancestors strictly between `element` and `root`, reporting
 * whether any one of them satisfies `cut`.
 *
 * Shared by {@link clippedByAncestor} and {@link clippedByAncestorRect}
 * rather than each climbing the chain on its own: the two answer different
 * questions about the same ancestor and must stop at the same first match for
 * the same reason `ancestorClipContext` is shared rather than re-derived —
 * two copies of "which elements to ask" agree on the day both are written and
 * are free to drift the moment either caller's walk changes.
 */
export function anyAncestorCuts(
  element: Element,
  root: Element,
  cut: (node: Element) => boolean
): boolean {
  for (
    let node: Element | null = element.parentElement;
    node !== null && node !== root;
    node = node.parentElement
  ) {
    if (cut(node)) return true;
  }
  return false;
}

/**
 * Whether an ancestor cuts the block's RECTANGLE — the whole of
 * {@link clippedByAncestorRect}'s verdict, and the first half of
 * {@link cutByAncestor}'s.
 *
 * ONE implementation rather than one per caller. The two questions differ by
 * the corner refinement below and by nothing else, so the straight-edge part
 * has to be the same reading in both — and it was not: written out twice, the
 * rect question guarded with `context.kind === "clips" && ...` while the
 * corner-aware one narrowed the union. A refusal reason added to
 * {@link AncestorClipContext} would have been gained by one caller and
 * silently skipped by the other.
 *
 * Exhaustive over the union deliberately: with no `default`, a fourth member
 * leaves this function able to return `undefined`, which its declared `boolean`
 * refuses. Both callers inherit that, which is the property the duplicate
 * version could not have.
 */
export function rectCut(context: AncestorClipContext, box: DOMRect): boolean {
  switch (context.kind) {
    case "no-clip":
      return false;
    case "cut":
      return true;
    case "clips":
      return cutByEdges(box, context.clip, context.clipsX, context.clipsY);
  }
}

/**
 * Whether a rounded clipping ancestor cuts the block at a CORNER — the
 * refinement {@link clippedByAncestor} adds and {@link clippedByAncestorRect}
 * deliberately does not.
 *
 * Only a `clips` ancestor has a curve to compare against: `no-clip` and `cut`
 * are already whole answers that {@link rectCut} gave, and asking a second
 * question about them would either re-refuse something or refuse something
 * nothing clips.
 */
export function cornerCut(
  context: AncestorClipContext,
  box: DOMRect,
  radii: CornerRadii
): boolean {
  if (context.kind !== "clips") return false;
  /*
   * The BLOCK's radii are composed here too, and for the same reason the
   * ancestor's geometry is.
   *
   * The caller scales them by the block's own composition, which stops below
   * the root — so the outer curve below carries the canvas scale and the inner
   * one does not. Compared across that difference, an oversized inner curve
   * reads as fitting inside the outer one, and a block whose visible corner IS
   * clipped keeps its bands and draws them over clipped pixels.
   *
   * Done at the comparison rather than at the call site: this is the only place
   * that holds both curves, and asking the caller to pre-compose one of them
   * puts half a decision somewhere that cannot see the other half.
   */
  const inner = scaleCornerRadii(radii, context.painted);
  return cutByCorner(
    box,
    inner,
    context.clip,
    context.style,
    context.scale,
    context.clipsX && context.clipsY,
    CLIP_SLACK_PX
  );
}

/**
 * What one ancestor's clip means for a descendant, computed ONCE and shared
 * by {@link clippedByAncestor} (the corner-aware question) and
 * {@link clippedByAncestorRect} (the straight-edge one) — reading `overflow`,
 * composing the rendered scale and resolving the clip rectangle are the same
 * work either caller needs, and a second reading of any of them is a second
 * chance for the two to disagree about the same ancestor.
 *
 * Three outcomes rather than a boolean, because "does not clip at all" and
 * "clips, but the geometry cannot be described" are different answers a
 * caller must not conflate: the first lets the walk continue up to the next
 * ancestor, the second is itself a refusal.
 */
export type AncestorClipContext =
  | { readonly kind: "no-clip" }
  | { readonly kind: "cut" }
  | {
      readonly kind: "clips";
      readonly clipsX: boolean;
      readonly clipsY: boolean;
      readonly style: CSSStyleDeclaration;
      readonly clip: EdgeBounds;
      readonly scale: RenderedScale;
      readonly painted: Scale;
    };

/**
 * How far a block may sit outside a clip edge before the overhang is real.
 *
 * Half a pixel, because both rectangles are fractional and a block laid out
 * flush against its container's edge is not clipped by rounding.
 */
const CLIP_SLACK_PX = 0.5;

/** The ancestor's PADDING edge, which is where overflow actually clips. */
export function clipEdges(
  outer: DOMRect,
  style: CSSStyleDeclaration,
  scale: RenderedScale
): EdgeBounds {
  return {
    top: outer.top + edgeWidth(style.borderTopWidth) * scale.y,
    left: outer.left + edgeWidth(style.borderLeftWidth) * scale.x,
    bottom: outer.bottom - edgeWidth(style.borderBottomWidth) * scale.y,
    right: outer.right - edgeWidth(style.borderRightWidth) * scale.x,
  };
}

/**
 * Whether the block falls outside the clip RECTANGLE, on an axis that clips.
 *
 * Each axis is asked only where it clips: a block overflowing the axis that is
 * still `visible` has its overflow rendered, and refusing it costs every band.
 */
function cutByEdges(
  box: DOMRect,
  clip: EdgeBounds,
  clipsX: boolean,
  clipsY: boolean
): boolean {
  const cutVertically =
    clipsY &&
    (box.top < clip.top - CLIP_SLACK_PX ||
      box.bottom > clip.bottom + CLIP_SLACK_PX);
  const cutHorizontally =
    clipsX &&
    (box.left < clip.left - CLIP_SLACK_PX ||
      box.right > clip.right + CLIP_SLACK_PX);
  return cutVertically || cutHorizontally;
}

/**
 * Whether a rounded clipping ancestor cuts the block at one of its CORNERS.
 *
 * A container with `border-radius` and `overflow: hidden` clips on the curve,
 * not on the rectangle: a child inside all four padding edges can still have a
 * corner visibly removed, and the comparison above accepts it. That container is
 * the ordinary card, so declining every rounded ancestor outright would blank
 * the overlay for most blocks on a real page — the exact test is what keeps the
 * refusal to the blocks that are genuinely cut.
 *
 * Asked only when BOTH axes clip, which is measured rather than assumed. With
 * `overflow: clip visible` the clip region is unbounded on the visible axis, and
 * a corner needs two bounds to exist — probed in Chromium, a child at the corner
 * of a 60px-radius box under `overflow: clip visible` is painted in full, while
 * the same child under `overflow: hidden` is cut away. Applying the arc there
 * would refuse a block nothing removes.
 *
 * The radii come off the PADDING box, because that is where overflow clips and
 * `border-radius` states the border box's curve.
 */
function cutByCorner(
  box: DOMRect,
  radii: CornerRadii,
  clip: EdgeBounds,
  style: CSSStyleDeclaration,
  scale: RenderedScale,
  bothAxesClip: boolean,
  slack: number
): boolean {
  if (!bothAxesClip) return false;
  const outer = usedCornerRadii(
    {
      topLeft: style.borderTopLeftRadius,
      topRight: style.borderTopRightRadius,
      bottomRight: style.borderBottomRightRadius,
      bottomLeft: style.borderBottomLeftRadius,
    },
    /*
     * The ancestor's LAYOUT size, so a percentage resolves against what the
     * author declared it against. `clip` is post-transform and inset to the
     * padding edge, so it is divided back out by the scale and re-widened by the
     * borders that were taken off it.
     */
    {
      width: (clip.right - clip.left) / scale.x + borderSpan(style, "x"),
      height: (clip.bottom - clip.top) / scale.y + borderSpan(style, "y"),
    }
  );
  /*
   * A radius this cannot resolve is a clip of UNKNOWN shape, and the block is
   * refused rather than treated as sitting inside a square one — the same answer
   * this module gives for every other geometry it cannot describe.
   */
  if (outer === undefined) return true;
  const inner = scaleCornerRadii(
    insetCornerRadii(outer, {
      top: edgeWidth(style.borderTopWidth),
      right: edgeWidth(style.borderRightWidth),
      bottom: edgeWidth(style.borderBottomWidth),
      left: edgeWidth(style.borderLeftWidth),
    }),
    scale
  );
  if (isSquare(inner)) return false;
  /*
   * The block's OWN curve is part of the comparison. A rounded block flush
   * inside an equally rounded container is not cut at all, while its bounding
   * rectangle's corners lie outside every one of that container's arcs — so
   * reading only the rectangle refuses the ordinary nested rounded card and
   * takes the whole overlay with it.
   */
  return !roundedInsideRounded(box, radii, clip, inner, slack);
}

/** The two border widths an axis loses, in unscaled CSS pixels. */
function borderSpan(style: CSSStyleDeclaration, axis: "x" | "y"): number {
  return axis === "x"
    ? edgeWidth(style.borderLeftWidth) + edgeWidth(style.borderRightWidth)
    : edgeWidth(style.borderTopWidth) + edgeWidth(style.borderBottomWidth);
}
