/**
 * Turning a pointer gesture on a spacing band into a style edit.
 *
 * The bands `spacing-bands.ts` draws are PHYSICAL — a rectangle above the block
 * is its top margin — while the catalog stores spacing LOGICALLY, as block and
 * inline start and end. Everything in this module exists on the seam between
 * those two vocabularies, plus the arithmetic that turns pointer travel into a
 * number an author would recognise.
 *
 * Deliberately free of React and of the DOM. The gesture that drives it lives
 * in `spacing-handles.tsx`, which is where capture, frames and focus belong; a
 * mapping from a side to an address is a pure question and testing it through a
 * rendered component would mean pointer plumbing standing between a wrong edge
 * and the test that is supposed to name it.
 *
 * ## Why the mapping is spelled out here and not asked of CSS
 *
 * `side-orientation.ts` says a hand-written map from a logical side to a
 * physical edge "would be a second implementation of something CSS already
 * does", and for the inspector's box that is right: it puts `writing-mode` on a
 * grid and lets the browser place four controls. That works because the box
 * only has to LOOK right. A drag has to WRITE, and no CSS property answers
 * "which logical side is the edge under this pointer" — the question runs the
 * other way, from a physical edge back to the name of the value to store. So
 * the table is stated, and the tests that hold it are the whole guard.
 *
 * ## Unresolved orientation refuses, and does not fall back to left-to-right
 *
 * `orientationOfElement` reports absence rather than guessing, for the reason
 * its docblock gives: an unread element and a left-to-right one are
 * indistinguishable, and the confident wrong answer is the expensive one. A
 * handle inherits that. Absent orientation means no handles at all — a drag
 * that edited `inlineStart` on an element whose inline start is the other edge
 * moves the block the wrong way and leaves an author no way to see why.
 *
 * @module spacing-drag
 */

import type { StyleValue } from "@nextlyhq/blocks-engine";

import { DEFAULT_ACTIVATION_PX } from "./canvas-drag";
import type { Scale } from "./geometry";
import type { SideOrientation } from "./side-orientation";
import type { SpacingBox, SpacingSide } from "./spacing-bands";
import { measurementOf } from "./style-numeric";
import type { LogicalSide } from "./style-sides";
import type { StyleAddress } from "./style-values";

/**
 * How far the pointer travels before a press on a handle becomes a drag.
 *
 * The canvas's own figure, imported rather than restated. Two thresholds in one
 * editor is two answers to "did the hand mean to move", and an author who has
 * learned one of them on the canvas would meet a different one an inch away.
 */
export const SPACING_ACTIVATION_PX = DEFAULT_ACTIVATION_PX;

/** How much one arrow key moves a value, in CSS pixels. */
export const SPACING_STEP_PX = 1;

/**
 * How much `PageUp` / `PageDown` moves a value.
 *
 * The coarse step is on Page rather than on `Shift`+arrow, which is where an
 * author would first reach for it. `Shift` already means "every side" for this
 * gesture, and it has to keep meaning that on the keyboard: WCAG 2.5.7 is
 * satisfied by a path that reaches the same VALUES as the pointer, so a
 * modifier that selected sides with one hand and step sizes with the other
 * would leave the all-sides edit reachable only by dragging.
 */
export const SPACING_PAGE_PX = 10;

/** The four physical sides, in the order a CSS shorthand writes them. */
const SIDES: readonly SpacingSide[] = ["top", "right", "bottom", "left"];

/** The side across the box from each one. */
const OPPOSITE: Record<SpacingSide, SpacingSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/**
 * Which physical edge the block axis starts at, and which the inline axis does
 * when the direction is left-to-right.
 *
 * Read from the CSS Writing Modes model, one row per `writing-mode` keyword:
 *
 * | mode | block start | inline start (ltr) |
 * | --- | --- | --- |
 * | `horizontal-tb` | top | left |
 * | `vertical-rl` | right | top |
 * | `vertical-lr` | left | top |
 * | `sideways-rl` | right | top |
 * | `sideways-lr` | left | **bottom** |
 *
 * `sideways-lr` is the row that is not a rotation of its neighbour and the one
 * a table built by symmetry gets wrong. Its text is turned 90° ANTI-clockwise
 * while every other vertical mode turns it clockwise, so its inline axis runs
 * up the screen and its left-to-right start is the BOTTOM edge. Reasoned from
 * the spec and then verified in a browser, because a mapping nobody can check
 * by looking at it is exactly the kind that stays wrong.
 */
const AXIS_STARTS = new Map<
  string,
  { readonly block: SpacingSide; readonly inline: SpacingSide }
>([
  ["horizontal-tb", { block: "top", inline: "left" }],
  ["vertical-rl", { block: "right", inline: "top" }],
  ["vertical-lr", { block: "left", inline: "top" }],
  ["sideways-rl", { block: "right", inline: "top" }],
  ["sideways-lr", { block: "left", inline: "bottom" }],
]);

/** The horizontal, left-to-right axes, which every unknown mode falls back to. */
const DEFAULT_AXES = { block: "top", inline: "left" } as const;

/**
 * The logical side a physical edge of this element is.
 *
 * An unrecognised `writing-mode` is read as `horizontal-tb`, which is the
 * initial value and what `spacingApplies` already does with one. A computed
 * style answers with a keyword, so this arm is reached only by a caller
 * synthesising an orientation — and horizontal is the answer that is right
 * unless the site went out of its way.
 *
 * `direction` decides only which END of the inline axis starts, and anything
 * that is not `rtl` is read as left-to-right for the same reason.
 *
 * @param side - the physical edge the handle sits on
 * @param orientation - the edited element's writing mode and direction
 * @returns the catalog's name for that side
 */
export function logicalSideFor(
  side: SpacingSide,
  orientation: SideOrientation
): LogicalSide {
  /*
   * A `Map`, so a writing mode named `constructor` or `toString` is a mode this
   * table does not have rather than a hit on `Object.prototype`. A plain object
   * answers those with a function, and `axes.block` is then `undefined` — which
   * reaches none of the branches below and silently reports every edge as the
   * inline end.
   */
  const axes = AXIS_STARTS.get(orientation.writingMode) ?? DEFAULT_AXES;
  const inlineStart =
    orientation.direction === "rtl" ? OPPOSITE[axes.inline] : axes.inline;
  if (side === axes.block) return "blockStart";
  if (side === OPPOSITE[axes.block]) return "blockEnd";
  return side === inlineStart ? "inlineStart" : "inlineEnd";
}

/** What the author is holding down while dragging or pressing a key. */
export interface SpacingModifiers {
  /** Every side of this box moves together. */
  readonly shift: boolean;
  /** This side and the one across from it move together. */
  readonly alt: boolean;
}

/**
 * The physical sides one gesture edits.
 *
 * `Shift` wins over `Alt` when both are held: it is the larger set, and the
 * opposite pair is contained in it, so there is no reading of "all four AND
 * this pair" that is not just all four.
 *
 * Returned in shorthand order rather than in the order the modifiers imply, so
 * the ops a commit builds are in one order whatever edge the drag started from
 * — two documents that differ only in which handle was grabbed would otherwise
 * compare unequal.
 *
 * @param side - the side the handle belongs to
 * @param modifiers - what is held down
 * @returns every physical side this gesture writes
 */
export function spacingSidesFor(
  side: SpacingSide,
  modifiers: SpacingModifiers
): readonly SpacingSide[] {
  if (modifiers.shift) return SIDES;
  if (modifiers.alt) {
    const pair = new Set<SpacingSide>([side, OPPOSITE[side]]);
    return SIDES.filter(one => pair.has(one));
  }
  return [side];
}

/** The two scales a band was drawn at. See `SpacingGeometry` for why there are two. */
export interface SpacingScales {
  /** The scale padding and border widths render at: the block's own transform included. */
  readonly scale: Scale;
  /** The scale a margin renders at: the ancestors' transform only. */
  readonly marginScale: Scale;
}

/**
 * How many CSS pixels of value one pointer movement is worth.
 *
 * ## The sign is "thicker", not "up" or "outward"
 *
 * A margin band lies outside the border edge and grows AWAY from the block; a
 * padding band lies inside it and grows TOWARD the middle. Dragging the top
 * margin's handle upward and the top padding's handle downward both make the
 * band under the pointer thicker, which is the one description that fits every
 * edge of both boxes — and it is what an author sees, because the handle sits
 * on the edge that moves.
 *
 * Stated as "outward for margin, inward for padding" it is the same table; a
 * single `outward` sign per side negated for padding is how it is written, so
 * the eight cases cannot disagree with each other.
 *
 * ## The scale is the band's own, and the caller does not choose it
 *
 * Padding renders inside the element's transform and a margin does not, so the
 * two are drawn at different scales — `SpacingGeometry` carries both for that
 * reason. Both go in here and this picks, rather than the caller passing "the"
 * scale: a handle that divided a margin by the composed scale is wrong by
 * exactly the block's own transform, which is invisible until someone scales a
 * block and then reports that dragging its margin moves twice as far as it
 * should.
 *
 * @param box - which box the band belongs to
 * @param side - the physical edge being dragged
 * @param movement - pointer travel in CLIENT pixels
 * @param scales - the scales the bands were measured at
 * @param outward - whether the responding edge moves AWAY from the block, which
 *   is the measured answer as it comes: NOT mirrored for a negative band, since
 *   the sign changes where the rectangle is drawn and not which edge responds
 * @returns the value change in CSS pixels, or `undefined` at an unusable scale
 */
export function spacingDelta(
  box: SpacingBox,
  side: SpacingSide,
  movement: { readonly dx: number; readonly dy: number },
  scales: SpacingScales,
  outward: boolean
): number | undefined {
  const scale = box === "margin" ? scales.marginScale : scales.scale;
  const vertical = side === "top" || side === "bottom";
  const factor = vertical ? scale.y : scale.x;
  /*
   * A zero or unreadable scale has no pixels to divide by. `describable`
   * already refuses a block collapsed to nothing, so this is the second guard
   * rather than the only one — but dividing here would produce `Infinity` and
   * commit it, and a refusal is the honest answer for a gesture whose distance
   * cannot be measured.
   */
  if (!Number.isFinite(factor) || factor === 0) return undefined;
  const travel = vertical ? movement.dy : movement.dx;
  // Positive where the band grows toward the pointer's direction of travel.
  const away = side === "top" || side === "left" ? -1 : 1;
  const sign = outward ? away : -away;
  const delta = (sign * travel) / factor;
  /*
   * `-0` normalised away. Negating a zero travel produces it, and it compares
   * equal to zero everywhere while printing as `-0` — so it passes every guard
   * and then appears in a serialised op, or in a message read to an author, as
   * a value nobody wrote.
   */
  return delta === 0 ? 0 : delta;
}

/**
 * Where a drag on this side starts from, or why it cannot start.
 *
 * `ok: false` is a real outcome and not an error path. The band shows a number
 * for every side, so every side LOOKS draggable, and the two cases below are
 * ones where the number on screen is not something a pixel edit can move
 * without destroying what produced it.
 */
export type SpacingStart =
  | { readonly ok: true; readonly px: number }
  | { readonly ok: false; readonly reason: string };

/** A stored value that is a token reference rather than a literal. */
function isTokenRef(value: StyleValue): value is { $token: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { $token?: unknown }).$token === "string"
  );
}

/**
 * The pixel number a stored value holds, or `undefined`.
 *
 * DERIVED from `style-numeric`'s grammar rather than matched with a pattern of
 * this module's own. A second parser here omitted a leading `+`, a leading-dot
 * fraction and an exponent — all of them valid CSS the catalog and the compiler
 * accept — so `+10px`, `.5px` and `1e2px` rendered normally while the handle
 * beside them refused to move, with nothing on screen to explain it. The
 * numeric affordance in the inspector already asks this question; asking it the
 * same way is what keeps the two surfaces agreeing about which values are
 * draggable.
 */
function pixelsOf(value: StyleValue): number | undefined {
  const measured = measurementOf(value);
  if (measured === undefined) return undefined;
  /*
   * A stored NUMBER carries no unit, and is read as pixels. `StyleValue` admits
   * one at a length position, and the alternative — refusing it — would make a
   * side undraggable for holding a quantity this gesture can express perfectly
   * well. Every other unit is refused: see the docblock above on why a `rem` or
   * a percentage must not be quietly replaced with the pixels it resolves to.
   */
  return measured.unit === "px" || measured.unit === ""
    ? measured.number
    : undefined;
}

/**
 * The pixel value a drag on this side begins at, or the reason it may not.
 *
 * ## A token is refused, not overwritten
 *
 * A side set to `{ $token: "space-4" }` renders whatever the token says and
 * follows it when the token moves. Committing `24px` over that severs the link
 * silently: the page looks identical at the instant of the drag and stops
 * tracking the design system forever after, which is the failure an author
 * cannot see. Refusing says so and leaves the inspector — where a token is
 * chosen deliberately — as the way to change it.
 *
 * ## So is any other unit, and `auto` most of all
 *
 * `margin` accepts `auto`, percentages and every CSS length, and the drag can
 * only speak pixels. `auto` is the one that matters: it is how a block is
 * centred, and replacing it with the pixel value it happens to resolve to
 * today un-centres the block the next time the container changes width. A
 * percentage and a `rem` are the same argument more quietly.
 *
 * ## Nothing stored is the ordinary case and is allowed
 *
 * A side with no value of its own inherits from a class, a block default or
 * nothing at all, and the band already shows the USED number. Starting there
 * and writing a pixel value is what an author asking to drag it means — the
 * first commit is an override, which is what the inspector's own fields do too.
 *
 * Rounded on the way in, so a used value of `10.5px` gives both the pointer and
 * the arrow keys the same integers to move between. Two paths that must reach
 * the same values cannot start half a pixel apart.
 *
 * @param stored - the node's OWN value at this address, if it has one
 * @param usedPx - the value the browser resolved, as the band reports it
 * @returns the starting pixel value, or the reason there is not one
 */
export function spacingStart(
  stored: StyleValue | undefined,
  usedPx: number
): SpacingStart {
  if (stored === undefined) {
    return Number.isFinite(usedPx)
      ? { ok: true, px: Math.round(usedPx) }
      : { ok: false, reason: "This spacing has no measured value to drag." };
  }
  if (isTokenRef(stored)) {
    return {
      ok: false,
      reason: "This side is set to a token. Change it in the Style panel.",
    };
  }
  const px = pixelsOf(stored);
  if (px !== undefined) return { ok: true, px: Math.round(px) };
  if (typeof stored === "string") {
    return {
      ok: false,
      reason: `This side is set to ${stored.trim()}. Change it in the Style panel.`,
    };
  }
  return {
    ok: false,
    reason: "This side is not a length. Change it in the Style panel.",
  };
}

/**
 * The value a side lands on, given where it started and how far the drag went.
 *
 * Padding is clamped at zero because CSS has no negative padding: without the
 * clamp a drag past the edge would build `-4px`, the catalog would refuse it,
 * and the handle would appear to stick for the rest of the gesture with nothing
 * said. A margin is not clamped — `allowNegative` is in the catalog and pulling
 * a block over its neighbour is a real thing authors do.
 *
 * Rounded, matching `spacingStart`: an author dragging reads whole pixels off
 * the band, and a stored `23.7003px` is a value nobody asked for.
 *
 * @param startPx - the value the gesture began at
 * @param delta - the change so far, in CSS pixels
 * @param box - which box, since only one of them may go below zero
 * @returns the value to preview or commit
 */
export function spacingValue(
  startPx: number,
  delta: number,
  box: SpacingBox
): number {
  const next = Math.round(startPx + delta);
  return box === "padding" ? Math.max(0, next) : next;
}

/**
 * What one arrow key means as a pointer movement, in CSS pixels.
 *
 * Only the two keys along the band's own axis. A left arrow on a top handle is
 * left alone rather than treated as zero, so it keeps whatever meaning the
 * surrounding editor gives it instead of being swallowed by a control it does
 * not address.
 */
const ARROW_MOVES = new Map<
  string,
  { readonly dx: number; readonly dy: number }
>([
  ["ArrowUp", { dx: 0, dy: -SPACING_STEP_PX }],
  ["ArrowDown", { dx: 0, dy: SPACING_STEP_PX }],
  ["ArrowLeft", { dx: -SPACING_STEP_PX, dy: 0 }],
  ["ArrowRight", { dx: SPACING_STEP_PX, dy: 0 }],
]);

/**
 * How far one key press moves this side's value, or `undefined` for a key that
 * means nothing here.
 *
 * ## The arrows go through the DRAG's own sign table
 *
 * An arrow is treated as a one-pixel pointer movement and put through
 * {@link spacingDelta}, rather than being given directions of its own. The two
 * paths have to agree — WCAG 2.5.7 is satisfied by a keyboard route that reaches
 * the same VALUES as the pointer, not merely by one that exists — and a second
 * table would be free to disagree about, say, whether Up grows a bottom padding.
 * That disagreement is invisible until someone compares the two by hand.
 *
 * The unit scale is passed because a key press is already a number of CSS
 * pixels: there is no canvas zoom to divide out of it.
 *
 * ## Page steps are a size, not a direction
 *
 * `PageUp` means "more" and `PageDown` means "less" whichever edge is focused,
 * so they take the sign table out of the question entirely. They carry the
 * coarse step because `Shift` is spoken for: it selects SIDES on both paths, and
 * a modifier that chose sides with the pointer and step sizes with the keyboard
 * would leave the all-sides edit reachable only by dragging.
 *
 * @param key - the `KeyboardEvent.key` that was pressed
 * @param box - which box the focused band belongs to
 * @param side - the physical edge the focused handle sits on
 * @param outward - whether the responding edge moves AWAY from the block, taken
 *   unmirrored exactly as {@link spacingDelta} takes it
 * @returns the value change in CSS pixels, or `undefined` to ignore the key
 */
export function spacingKeyDelta(
  key: string,
  box: SpacingBox,
  side: SpacingSide,
  outward: boolean
): number | undefined {
  if (key === "PageUp") return SPACING_PAGE_PX;
  if (key === "PageDown") return -SPACING_PAGE_PX;
  /*
   * Up MEANS MORE on every handle, and Down means less.
   *
   * The handles are spinbuttons, and Up and Down are that role's own keys: a
   * screen-reader user told they have an adjustable number expects them to work
   * the same way on all eight, whichever edge is focused. Read spatially they
   * would do nothing on a left or right handle at all, and would run backwards
   * on a bottom margin and a top padding — where moving DOWN is what grows the
   * value.
   *
   * The spatial reading survives beside it, on the axis each band actually runs
   * along, because a pointer user reaches for the arrow that points the way the
   * edge moves. The two only disagree where a numeric answer exists, and there
   * the numeric one wins: a vertical band takes its meaning from this table,
   * and a horizontal band keeps Left and Right as travel.
   */
  if (key === "ArrowUp") return SPACING_STEP_PX;
  if (key === "ArrowDown") return -SPACING_STEP_PX;
  /*
   * A `Map` rather than an object literal, and it is not defensive dressing:
   * `KeyboardEvent.key` is an arbitrary string, and an object lookup answers
   * `constructor` with a function. Measured before this changed — a
   * `constructor` press on a LEFT handle read `.dx` off that function, got
   * `undefined`, and returned `NaN` as the distance to move.
   */
  const move = ARROW_MOVES.get(key);
  if (move === undefined) return undefined;
  // Across the band's own axis this key addresses nothing.
  const vertical = side === "top" || side === "bottom";
  if (vertical !== (move.dx === 0)) return undefined;
  return spacingDelta(
    box,
    side,
    move,
    { scale: { x: 1, y: 1 }, marginScale: { x: 1, y: 1 } },
    outward
  );
}

/**
 * Whether the drawn BAND thickens away from the block, which is where its
 * handle goes.
 *
 * The box does not decide this, though a margin can look as though it settles
 * the question: lying outside the border box, growing one seems unable to move
 * it. Measured, that is false for `margin-top`, for `margin-left`, and for
 * `margin-right` on an auto-width block — `spacing-response.ts` carries the
 * table and answers for both boxes.
 *
 * A NEGATIVE band mirrors it, and this is the only question it mirrors.
 * `spacingBands` lays a negative margin INSIDE the border edge, reflected
 * across it, so the rectangle's two edges swap which of them is the far one.
 *
 * THIS IS NOT THE DRAG DIRECTION. Where the handle sits and which way the
 * NUMBER grows are separate questions, and a negative band answers them
 * differently: the value of a
 * `margin-top` rising from `-20px` to `-10px` moves the border edge DOWN, the
 * same direction it moves for a positive one, because the physical edge that
 * responds does not care about the sign. Only the rectangle is mirrored, so
 * only this is. `spacingDelta` takes the measured answer unmirrored.
 *
 * @param negative - whether a margin band is a negative one
 * @param measured - whether the band's OUTER edge was seen to respond
 */
export function spacingBandDrawnOutward(
  negative: boolean,
  measured: boolean
): boolean {
  return measured !== negative;
}

/** The address one side of one box occupies at the tier being edited. */
export function spacingAddress(
  box: SpacingBox,
  side: LogicalSide,
  tier: { readonly state: StyleAddress["state"]; readonly breakpoint: string }
): StyleAddress {
  return {
    state: tier.state,
    breakpoint: tier.breakpoint,
    // The catalog's key IS the box name for both boxes, so there is no table
    // here to fall out of step with `catalog.ts`.
    property: box,
    path: [side],
  };
}

/** The value a style write carries for a pixel length. */
export function spacingCssValue(px: number): string {
  return `${String(px)}px`;
}
