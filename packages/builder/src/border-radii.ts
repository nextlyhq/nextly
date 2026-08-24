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
 * Answers UNDEFINED rather than zero for anything it cannot read, and the
 * difference is the whole point: zero means a square corner, and a value this
 * cannot resolve is a corner of UNKNOWN shape. Reading the second as the first
 * is what makes a rounded block draw square bands.
 *
 * It is reachable. A percentage inside a math function stays unresolved in the
 * computed value because it still depends on the box — measured, `border-radius:
 * calc(10% + 5px)` computes as `"calc(10% + 5px)"` while `calc(10px + 5px)`
 * computes as `"15px"` — and the catalog accepts a `calc()` length.
 *
 * An EMPTY value is the one unreadable case that is not unknown. A computed
 * style never reports a supported longhand as blank, so a blank one means the
 * engine has no such property — and an engine with no `border-radius` draws a
 * square corner, which is exactly what zero says. Treating it as unknown instead
 * would refuse every block in any renderer that does not implement the
 * property, jsdom included.
 */
function lengthAgainst(token: string, basis: number): number | undefined {
  if (token === "") return 0;
  const parsed = Number.parseFloat(token);
  if (!Number.isFinite(parsed)) return undefined;
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
function parseCorner(value: string, box: BoxSize): CornerRadius | undefined {
  const tokens = value.trim().split(/\s+/);
  const horizontal = tokens[0] ?? "0";
  const vertical = tokens[1] ?? horizontal;
  const x = lengthAgainst(horizontal, box.width);
  const y = lengthAgainst(vertical, box.height);
  if (x === undefined || y === undefined) return undefined;
  return { x, y };
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
 *
 * UNDEFINED when any corner cannot be resolved, which callers are expected to
 * treat as a shape they cannot describe rather than as a square one.
 */
export function usedCornerRadii(
  declared: DeclaredRadii,
  box: BoxSize
): CornerRadii | undefined {
  const topLeft = parseCorner(declared.topLeft, box);
  const topRight = parseCorner(declared.topRight, box);
  const bottomRight = parseCorner(declared.bottomRight, box);
  const bottomLeft = parseCorner(declared.bottomLeft, box);
  if (
    topLeft === undefined ||
    topRight === undefined ||
    bottomRight === undefined ||
    bottomLeft === undefined
  ) {
    return undefined;
  }
  const resolved: CornerRadii = { topLeft, topRight, bottomRight, bottomLeft };
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
 * The most samples one corner arc is ever cut into.
 *
 * A rounded inner shape's extreme point in a corner is not its box corner — it
 * is a point on its own arc — so the two curves have to be compared along their
 * length rather than at one point, and the comparison is only as good as the
 * chord between samples.
 *
 * The count is DERIVED from the radius rather than fixed, because a fixed one is
 * wrong at both ends: it wastes several dozen evaluations on a four-pixel corner
 * and runs out of precision on a large one. A fixed sixty-four exceeds a
 * half-pixel allowance somewhere above a 6,600px rendered half-axis — reachable
 * on a large box, and more easily under an ancestor `scale`, where the allowance
 * would go NEGATIVE and refuse two identical flush rectangles.
 *
 * The cap bounds the cost. At this many samples the chord stays within a quarter
 * pixel of the arc out to a radius of some 210,000px, which no layout reaches;
 * past it, `roundedInsideRounded` refuses rather than answering to a precision it
 * cannot deliver.
 */
const MAX_ARC_SAMPLES = 512;

/** The fewest, for a corner so small the chord is already the arc. */
const MIN_ARC_SAMPLES = 4;

/**
 * How far a sampled chord can fall short of the arc it stands in for.
 *
 * The worst case sits half a step along, at `r * (1 - cos(theta / 2))` for a step
 * of `theta`. Taken off the caller's allowance rather than ignored, so the
 * approximation spends the slack instead of exceeding it.
 */
function chordError(radius: number, samples: number): number {
  return radius * (1 - Math.cos(Math.PI / (4 * samples)));
}

/**
 * The fewest samples that keep {@link chordError} within `target`.
 *
 * Inverting the expression above: a step of `2 * acos(1 - target / radius)`
 * lands exactly on the target, and a quarter turn needs that many of them.
 */
function arcSamplesFor(radius: number, target: number): number {
  if (!(radius > 0) || !(target > 0)) return MIN_ARC_SAMPLES;
  const step = 2 * Math.acos(Math.max(-1, 1 - target / radius));
  if (!(step > 0)) return MAX_ARC_SAMPLES;
  const needed = Math.ceil(Math.PI / 2 / step);
  return Math.min(MAX_ARC_SAMPLES, Math.max(MIN_ARC_SAMPLES, needed));
}

/** Which side of the box each corner sits on: -1 is left or top, 1 right or bottom. */
const CORNER_SIGNS = {
  topLeft: { x: -1, y: -1 },
  topRight: { x: 1, y: -1 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft: { x: -1, y: 1 },
} as const satisfies Record<keyof CornerRadii, { x: -1 | 1; y: -1 | 1 }>;

/** The largest half-axis anywhere on a shape, which is what bounds the error. */
function largestRadius(radii: CornerRadii): number {
  let largest = 0;
  for (const corner of CORNERS) {
    largest = Math.max(largest, radii[corner].x, radii[corner].y);
  }
  return largest;
}

/**
 * Whether one corner of the inner shape stays inside the matching corner of the
 * outer one.
 *
 * A corner with a zero half-axis is square on BOTH axes — an ellipse with no
 * interior cuts nothing — so its radii are zeroed together before sampling
 * rather than one at a time, which would otherwise put the sampled point a
 * radius away from the box corner it should be at.
 */
function cornerInside(
  corner: keyof CornerRadii,
  box: EdgeBounds,
  boxRadius: CornerRadius,
  clip: EdgeBounds,
  clipRadius: CornerRadius,
  slack: number,
  samples: number
): boolean {
  // A square outer corner cuts nothing the straight-edge comparison has not
  // already answered.
  if (clipRadius.x <= 0 || clipRadius.y <= 0) return true;
  const own = boxRadius.x > 0 && boxRadius.y > 0 ? boxRadius : SQUARE;
  const sign = CORNER_SIGNS[corner];
  const centre = arcCentre(sign, box, own);
  const against = arcCentre(sign, clip, clipRadius);
  const steps = own.x > 0 ? samples : 1;
  for (let step = 0; step < steps; step += 1) {
    const angle = (step / Math.max(1, steps - 1)) * (Math.PI / 2);
    const px = centre.x + sign.x * own.x * Math.cos(angle);
    const py = centre.y + sign.y * own.y * Math.sin(angle);
    const dx = sign.x * (px - against.x) - slack;
    const dy = sign.y * (py - against.y) - slack;
    if (!insideArc(dx, dy, clipRadius)) return false;
  }
  return true;
}

/**
 * Where a corner's arc is centred: one radius in along each axis from it.
 *
 * The same arithmetic for the inner shape and the outer one, which is the point
 * — the two are compared in the same frame, and a sign written out twice is a
 * sign that can be written differently twice.
 */
function arcCentre(
  sign: { readonly x: -1 | 1; readonly y: -1 | 1 },
  bounds: EdgeBounds,
  radius: CornerRadius
): { readonly x: number; readonly y: number } {
  return {
    x: sign.x < 0 ? bounds.left + radius.x : bounds.right - radius.x,
    y: sign.y < 0 ? bounds.top + radius.y : bounds.bottom - radius.y,
  };
}

/**
 * Whether one rounded rectangle lies inside another.
 *
 * The caller is expected to have compared the two rectangles first: this asks
 * only the question the rectangular comparison cannot, which is whether a shape
 * inside all four straight edges still pokes through one of the four arcs.
 *
 * The INNER shape's own curve is part of the question, not a detail. A rounded
 * block flush inside an equally rounded clipping container is not cut at all,
 * while its bounding rectangle's corners lie outside every one of that
 * container's arcs — so a test that reads only the rectangle refuses the
 * ordinary nested rounded card and takes the whole overlay with it.
 *
 * `slack` means the same thing here as it does for the straight edges: how far a
 * shape may overhang before the overhang is real rather than a rounding artefact
 * of two fractional measurements. The sampling bound comes off it, so the
 * approximation spends the allowance rather than exceeding it.
 */
export function roundedInsideRounded(
  box: EdgeBounds,
  boxRadii: CornerRadii,
  clip: EdgeBounds,
  clipRadii: CornerRadii,
  slack: number
): boolean {
  const largest = largestRadius(boxRadii);
  /*
   * Half the allowance is spent on the approximation and half kept for the
   * fractional measurements the slack exists for, so neither can consume the
   * other.
   */
  const samples = arcSamplesFor(largest, slack / 2);
  /*
   * Past the cap the chords are further from the arcs than the whole allowance
   * and this goes NEGATIVE, which is deliberate rather than a case to guard.
   * A negative allowance makes every depth larger, so the comparison tightens
   * instead of loosening: a shape sitting on the curve is refused while one
   * comfortably inside is still accepted, which is exactly the right way to
   * degrade. An explicit refusal here would throw away the second answer as
   * well, and the arithmetic already delivers the first.
   */
  const allowance = slack - chordError(largest, samples);
  return CORNERS.every(corner =>
    cornerInside(
      corner,
      box,
      boxRadii[corner],
      clip,
      clipRadii[corner],
      allowance,
      samples
    )
  );
}

/**
 * A rounded rectangle in the coordinate space of the element it clips.
 *
 * The shape a band must be cut to is the block's rounded box, which is a
 * different rectangle from the band — so it is stated relative to the band's own
 * origin, which is what a `clip-path` is resolved against.
 */
export interface RoundedShape {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radii: CornerRadii;
}

/** Where `shape` sits inside `clipped`, in `clipped`'s own coordinates. */
export function roundedShapeIn(
  clipped: Rect,
  shape: Rect,
  radii: CornerRadii
): RoundedShape {
  return {
    x: shape.x - clipped.x,
    y: shape.y - clipped.y,
    width: shape.width,
    height: shape.height,
    radii,
  };
}

/**
 * The shape as the `clip-path` value that cuts a band's fill to it.
 *
 * A PATH rather than `inset(... round ...)`, and that is not a style choice.
 * `inset()` resolves its radii the way `border-radius` does, which includes the
 * overlap reduction against the inset rectangle — so a padding-box curve that
 * legitimately exceeds its own box is silently shrunk by the browser and the
 * clip stops following the element's real edge.
 *
 * That case is exactly the one this module documents: an outer corner of 100
 * less a 10px border leaves an inner curve of 90 on a padding box only 80 tall,
 * and the engine draws the 90. Measured — a 180x80 element under
 * `inset(0 round 90px)` is cut at 80, so the two disagree wherever a border is
 * thick enough to matter. A path states the arcs outright and is not
 * renormalised.
 *
 * An arc with a zero radius is drawn as a straight line by the SVG path
 * grammar, so a square corner needs no special case and every shape is written
 * the same way.
 */
export function clipPathOf(shape: RoundedShape): string {
  const n = (value: number): string => String(Math.round(value * 100) / 100);
  const { radii } = shape;
  const left = shape.x;
  const top = shape.y;
  const right = shape.x + shape.width;
  const bottom = shape.y + shape.height;
  const arc = (radius: CornerRadius, x: number, y: number): string =>
    `A ${n(radius.x)} ${n(radius.y)} 0 0 1 ${n(x)} ${n(y)}`;
  const steps = [
    `M ${n(left + radii.topLeft.x)} ${n(top)}`,
    `L ${n(right - radii.topRight.x)} ${n(top)}`,
    arc(radii.topRight, right, top + radii.topRight.y),
    `L ${n(right)} ${n(bottom - radii.bottomRight.y)}`,
    arc(radii.bottomRight, right - radii.bottomRight.x, bottom),
    `L ${n(left + radii.bottomLeft.x)} ${n(bottom)}`,
    arc(radii.bottomLeft, left, bottom - radii.bottomLeft.y),
    `L ${n(left)} ${n(top + radii.topLeft.y)}`,
    arc(radii.topLeft, left + radii.topLeft.x, top),
    "Z",
  ];
  return `path("${steps.join(" ")}")`;
}
