/**
 * The used corner radii of a CSS box, as arithmetic over plain numbers.
 *
 * A rounded box is not the rectangle `getBoundingClientRect` reports for it, and
 * two things in this package care. The spacing overlay paints bands inside the
 * padding box, which on a rounded block curves away from the rectangle those
 * bands are cut from; and an ancestor that clips its overflow clips on that same
 * curve, so a child sitting inside all four of its padding edges can still be
 * visibly cut at a corner.
 *
 * Both need the USED radii, and reaching them from the computed value is three
 * steps that do not commute:
 *
 * 1. **Resolve.** A percentage stays a percentage in the computed value —
 *    `border-radius: 50%` computes as `"50%"` — and resolves against the border
 *    box, horizontally against its width and vertically against its height. A
 *    corner serializes as TWO values when it is elliptical (`"10px 30px"`) and
 *    one when it is not, and both forms occur.
 * 2. **Reduce.** CSS Backgrounds §5.5 shrinks every radius by a single factor
 *    when any side's two radii would overlap: `f = min(Lᵢ / Sᵢ)` over the four
 *    sides, where `Lᵢ` is the side's length and `Sᵢ` the sum of the two radii
 *    meeting it, applied to all eight radii when it comes out below one. The
 *    engine does not do this in the computed value — `border-radius: 200px` on a
 *    200×100 box still computes as `200px` while it renders as 50 — so a reader
 *    that trusts the computed value describes a corner four times the size of
 *    the one on screen. ONE factor for the whole box, not one per corner:
 *    measured, a 200×100 box with only `border-top-left-radius: 200px` draws
 *    that corner at 100, which is the box's own height constraining it through
 *    the shared factor.
 * 3. **Inset.** The padding box's radius is the border box's less that corner's
 *    two border widths, floored at zero — and NOT reduced a second time, even
 *    when the result no longer fits the padding box. Measured on a 200×100 box
 *    with `border-top-left-radius: 100px` and a 10px border: the inner curve is
 *    90, while the padding box is only 80 tall, and the engine draws the 90.
 *
 * Reducing after insetting gives different numbers than insetting after
 * reducing, and the order above is the one CSS specifies — the same box
 * separates them, since insetting first and then reducing against the 180×80
 * padding box would give 80 where the engine draws 90.
 *
 * Kept away from the DOM for the reason `spacing-bands.ts` gives about itself:
 * jsdom lays nothing out and reports every element as zero-sized, so a rule
 * written against live elements can only be exercised in a browser, while the
 * same rule written against numbers can be exercised anywhere.
 *
 * @module border-radii
 */

import type { EdgeLengths, Rect, Scale } from "./geometry";

/**
 * One corner, as its two half-axes.
 *
 * Always a pair, never a single number: `border-radius: 10px / 30px` is one
 * declaration and an elliptical corner is what most `border-radius: 50%` boxes
 * actually have, since a non-square box resolves the two percentages against
 * different lengths.
 */
export interface CornerRadius {
  /** The half-axis along the box's width. */
  readonly x: number;
  /** The half-axis along the box's height. */
  readonly y: number;
}

/** The four corners, in the order the `border-radius` shorthand writes them. */
export interface CornerRadii {
  readonly topLeft: CornerRadius;
  readonly topRight: CornerRadius;
  readonly bottomRight: CornerRadius;
  readonly bottomLeft: CornerRadius;
}

/**
 * The four computed `border-*-radius` values, exactly as a computed style
 * reports them.
 *
 * Strings rather than numbers because that is the whole of what the DOM offers,
 * and resolving them needs the box they were declared on — which the reader has
 * and the parser would otherwise have to be told twice.
 */
export interface DeclaredRadii {
  readonly topLeft: string;
  readonly topRight: string;
  readonly bottomRight: string;
  readonly bottomLeft: string;
}

/** A corner with no curve at all. */
const SQUARE: CornerRadius = { x: 0, y: 0 };

/** The radii of a box with no `border-radius`, which is nearly every box. */
export const SQUARE_CORNERS: CornerRadii = {
  topLeft: SQUARE,
  topRight: SQUARE,
  bottomRight: SQUARE,
  bottomLeft: SQUARE,
};

/** The four corners by name, in the order the shorthand writes them. */
const CORNERS = [
  "topLeft",
  "topRight",
  "bottomRight",
  "bottomLeft",
] as const satisfies readonly (keyof CornerRadii)[];

/**
 * Whether every corner is square, so no consumer needs to clip anything.
 *
 * A corner is square when EITHER half-axis is zero, not only when both are.
 * `border-radius: 40px / 0` is a legal declaration and draws a right angle: an
 * ellipse with a zero half-axis has no interior, so the corner it cuts away is
 * empty. Reading only one axis calls that corner curved and sends every consumer
 * on to divide by the other.
 */
export function isSquare(radii: CornerRadii): boolean {
  return CORNERS.every(corner => radii[corner].x <= 0 || radii[corner].y <= 0);
}

/** The size of the box a radius is resolved against. */
interface BoxSize {
  readonly width: number;
  readonly height: number;
}

/**
 * One computed `<length-percentage>` against the length it is a fraction of.
 *
 * Anything unparseable answers zero rather than propagating a `NaN`, which would
 * poison every comparison downstream into silently answering false.
 */
function lengthAgainst(token: string, basis: number): number {
  const parsed = Number.parseFloat(token);
  if (!Number.isFinite(parsed)) return 0;
  const length = token.endsWith("%") ? (parsed / 100) * basis : parsed;
  // A negative radius is invalid CSS and never computes, but the floor costs
  // nothing and keeps a hand-built input from producing an inverted corner.
  return Math.max(0, length);
}

/**
 * One corner's computed value, which is one token or two.
 *
 * With a single token the SAME token resolves twice, once against each axis —
 * so `50%` is half the width horizontally and half the height vertically, and
 * only a length comes out equal on both.
 */
function parseCorner(value: string, box: BoxSize): CornerRadius {
  const tokens = value.trim().split(/\s+/);
  const horizontal = tokens[0] ?? "0";
  const vertical = tokens[1] ?? horizontal;
  return {
    x: lengthAgainst(horizontal, box.width),
    y: lengthAgainst(vertical, box.height),
  };
}

/**
 * The factor CSS Backgrounds §5.5 shrinks every radius by when two meeting on
 * one side would together be longer than it.
 *
 * One factor for the whole box rather than one per side, which is what keeps the
 * corners consistent with each other: reducing only the offending side would
 * leave the two ends of an adjacent side scaled differently and the curve would
 * no longer meet the edge.
 *
 * A side with no curve on it contributes nothing — `Lᵢ / 0` is infinite, and a
 * box whose radii are all zero would otherwise reduce by `Infinity`.
 */
function reductionFactor(radii: CornerRadii, box: BoxSize): number {
  const sides = [
    { length: box.width, sum: radii.topLeft.x + radii.topRight.x },
    { length: box.height, sum: radii.topRight.y + radii.bottomRight.y },
    { length: box.width, sum: radii.bottomRight.x + radii.bottomLeft.x },
    { length: box.height, sum: radii.bottomLeft.y + radii.topLeft.y },
  ];
  let factor = 1;
  for (const { length, sum } of sides) {
    if (sum > 0) factor = Math.min(factor, length / sum);
  }
  return factor;
}

/** Every radius multiplied by one factor, per axis. */
function mapCorners(
  radii: CornerRadii,
  by: (corner: CornerRadius) => CornerRadius
): CornerRadii {
  return {
    topLeft: by(radii.topLeft),
    topRight: by(radii.topRight),
    bottomRight: by(radii.bottomRight),
    bottomLeft: by(radii.bottomLeft),
  };
}

/**
 * The border box's used radii: resolved against it, then reduced to fit it.
 *
 * `box` is the BORDER box, in the same units the declarations are in — unscaled
 * CSS pixels. Handing it a post-transform rectangle resolves every percentage
 * against the rendered size, which is right only while the scale is one.
 */
export function usedCornerRadii(
  declared: DeclaredRadii,
  box: BoxSize
): CornerRadii {
  const resolved: CornerRadii = {
    topLeft: parseCorner(declared.topLeft, box),
    topRight: parseCorner(declared.topRight, box),
    bottomRight: parseCorner(declared.bottomRight, box),
    bottomLeft: parseCorner(declared.bottomLeft, box),
  };
  const factor = reductionFactor(resolved, box);
  if (factor >= 1) return resolved;
  return mapCorners(resolved, corner => ({
    x: corner.x * factor,
    y: corner.y * factor,
  }));
}

/**
 * The padding box's radii, given the border box's.
 *
 * Each half-axis loses the border width it runs alongside — the horizontal one
 * the left or right border, the vertical one the top or bottom — and a border
 * thicker than the curve squares the corner off rather than inverting it.
 */
export function insetCornerRadii(
  radii: CornerRadii,
  borders: EdgeLengths
): CornerRadii {
  const shrink = (value: number, by: number): number => Math.max(0, value - by);
  return {
    topLeft: {
      x: shrink(radii.topLeft.x, borders.left),
      y: shrink(radii.topLeft.y, borders.top),
    },
    topRight: {
      x: shrink(radii.topRight.x, borders.right),
      y: shrink(radii.topRight.y, borders.top),
    },
    bottomRight: {
      x: shrink(radii.bottomRight.x, borders.right),
      y: shrink(radii.bottomRight.y, borders.bottom),
    },
    bottomLeft: {
      x: shrink(radii.bottomLeft.x, borders.left),
      y: shrink(radii.bottomLeft.y, borders.bottom),
    },
  };
}

/**
 * Radii moved from layout pixels into the rendered pixels a transform draws
 * them at.
 *
 * Per-axis for the reason every other scale here is: `scale(2, 0.5)` is a single
 * legal value, and one factor would be right on one axis and wrong on the other.
 */
export function scaleCornerRadii(
  radii: CornerRadii,
  scale: Scale
): CornerRadii {
  return mapCorners(radii, corner => ({
    x: corner.x * scale.x,
    y: corner.y * scale.y,
  }));
}

/** A rectangle given by its four edge COORDINATES rather than an origin and a size. */
export interface EdgeBounds {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Whether a point reaching `dx` past a corner's horizontal centre and `dy` past
 * its vertical one is still inside that corner's arc.
 *
 * The two depths are measured from the arc's CENTRE — the point one radius in
 * along each axis — because that is where the ellipse is centred. A depth at or
 * below zero means the box never reaches into the corner's quarter at all on
 * that axis, which is the common case and the one that must not be mistaken for
 * a violation.
 */
function insideArc(dx: number, dy: number, radius: CornerRadius): boolean {
  if (radius.x <= 0 || radius.y <= 0) return true;
  if (dx <= 0 || dy <= 0) return true;
  const nx = dx / radius.x;
  const ny = dy / radius.y;
  return nx * nx + ny * ny <= 1;
}

/**
 * Whether a rectangle lies inside a ROUNDED one.
 *
 * The caller is expected to have compared the two rectangles first: this asks
 * only the question the rectangular comparison cannot, which is whether a box
 * inside all four straight edges still pokes through one of the four arcs.
 *
 * `slack` is subtracted from each depth rather than from the rectangles, so it
 * means the same thing here as it does there — how far a box may overhang before
 * the overhang is real rather than a rounding artefact of two fractional
 * measurements.
 */
export function boundsInsideRounded(
  box: EdgeBounds,
  clip: EdgeBounds,
  radii: CornerRadii,
  slack: number
): boolean {
  const left = (radius: number): number =>
    clip.left + radius - box.left - slack;
  const right = (radius: number): number =>
    box.right - (clip.right - radius) - slack;
  const top = (radius: number): number => clip.top + radius - box.top - slack;
  const bottom = (radius: number): number =>
    box.bottom - (clip.bottom - radius) - slack;

  return (
    insideArc(left(radii.topLeft.x), top(radii.topLeft.y), radii.topLeft) &&
    insideArc(right(radii.topRight.x), top(radii.topRight.y), radii.topRight) &&
    insideArc(
      right(radii.bottomRight.x),
      bottom(radii.bottomRight.y),
      radii.bottomRight
    ) &&
    insideArc(
      left(radii.bottomLeft.x),
      bottom(radii.bottomLeft.y),
      radii.bottomLeft
    )
  );
}

/**
 * A rounded rectangle expressed as insets from the rectangle it clips.
 *
 * The shape a band must be cut to is the block's rounded box, which is a
 * different rectangle from the band — so it cannot be stated in the band's own
 * terms without saying how far each of its edges is from the shape's. That is
 * exactly the form `clip-path: inset()` takes, and stating it here rather than
 * building the CSS keeps the arithmetic testable without a browser.
 */
export interface RoundedInset {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  readonly radii: CornerRadii;
}

/** Where `shape` sits inside `clipped`, as one inset per edge. */
export function roundedInsetOf(
  clipped: Rect,
  shape: Rect,
  radii: CornerRadii
): RoundedInset {
  return {
    top: shape.y - clipped.y,
    left: shape.x - clipped.x,
    right: clipped.x + clipped.width - (shape.x + shape.width),
    bottom: clipped.y + clipped.height - (shape.y + shape.height),
    radii,
  };
}

/**
 * A rounded inset as the `clip-path` value that cuts a band's fill to it.
 *
 * Built here rather than at the call site so the shape and its CSS spelling stay
 * in one module: the two radius lists are written horizontal-then-vertical
 * across a solidus, an order that is easy to transpose and impossible to notice
 * once transposed, since it is wrong only on an elliptical corner.
 */
export function clipPathOf(inset: RoundedInset): string {
  const px = (value: number): string =>
    `${String(Math.round(value * 100) / 100)}px`;
  const corners = CORNERS.map(corner => inset.radii[corner]);
  const horizontal = corners.map(corner => px(corner.x)).join(" ");
  const vertical = corners.map(corner => px(corner.y)).join(" ");
  const edges = [inset.top, inset.right, inset.bottom, inset.left]
    .map(px)
    .join(" ");
  return `inset(${edges} round ${horizontal} / ${vertical})`;
}
