/**
 * The four sides of a per-side property, recognised so they can be drawn as a
 * box rather than as four rows.
 *
 * `margin` and `padding` are ONE catalog property each, whose `logicalSides`
 * shape the control walk flattens into four independent controls. That is the
 * right model — each side commits on its own, and undo stays per side — and it
 * is the wrong picture: four stacked rows say nothing about which edge each one
 * is, so an author reads four labels to answer a question a diagram answers at
 * a glance.
 *
 * This groups them for the DRAWING only. Nothing about how a side is stored,
 * committed or undone changes.
 *
 * ## The vocabulary is DERIVED, not restated
 *
 * `LogicalSide` is `keyof LogicalSidesShape["sides"]`, so the engine's catalog
 * decides what the sides are and this module only decides what ORDER to draw
 * them in. `DRAW_ORDER` is a `Record` over that union rather than a list, which
 * is what makes the derivation load-bearing: a side added to the engine leaves
 * a missing key and a side renamed leaves both a missing and an excess one, and
 * either fails `check-types` here. A list would have gone on compiling while
 * quietly dropping the new side out of the box.
 *
 * ## LOGICAL, not physical
 *
 * The sides are block/inline, not top/left, and the difference is not pedantry:
 * in a right-to-left context the inline start is on the RIGHT, and in a
 * vertical writing mode the block axis is horizontal. Which physical edge each
 * one lands on is NOT decided here — it is a property of the element being
 * edited, and `side-orientation.ts` resolves it from that element.
 *
 * @module style-sides
 */
import type { LogicalSidesShape } from "@nextlyhq/blocks-engine";

import type { SideOrientation } from "./side-orientation";
import type { StyleControl } from "./style-controls";

/** One of the four sides, as the engine's catalog names them. */
export type LogicalSide = keyof LogicalSidesShape["sides"];

/**
 * Where each side sits in the drawn box, top row first.
 *
 * A `Record` over the engine's own union, so this cannot fall out of step with
 * the catalog without failing to compile. The numbers are this module's
 * decision — they are a reading order, which the engine has no opinion about.
 */
const DRAW_ORDER: Record<LogicalSide, number> = {
  blockStart: 0,
  inlineStart: 1,
  inlineEnd: 2,
  blockEnd: 3,
};

/**
 * The four sides, in the order the box draws them.
 *
 * Derived from `DRAW_ORDER` rather than written out a second time: two lists of
 * the same four names is exactly the drift this module exists to avoid.
 */
export const LOGICAL_SIDES: readonly LogicalSide[] = (
  Object.keys(DRAW_ORDER) as LogicalSide[]
).sort((a, b) => DRAW_ORDER[a] - DRAW_ORDER[b]);

/**
 * The controls of a per-side property, in box order, or `undefined`.
 *
 * All four or none. Drawing three sides in a box arrangement would position
 * them as edges while leaving one edge missing and unexplained, which is worse
 * than four honest rows — so a property that does not offer the whole set keeps
 * the ordinary layout.
 *
 * @param controls - every control the property expanded into
 * @returns the four side controls in draw order, or `undefined` if not per-side
 */
export function logicalSideGroup(
  controls: readonly StyleControl[]
): readonly StyleControl[] | undefined {
  if (controls.length !== LOGICAL_SIDES.length) return undefined;

  const bySide = new Map<string, StyleControl>();
  for (const control of controls) {
    // Depth one only. A side reached through a union arm or an object field is
    // a different address, and treating it as a side would place a control in
    // an edge it does not describe.
    if (control.path.length !== 1) return undefined;
    const side = control.path[0];
    if (side === undefined) return undefined;
    bySide.set(side, control);
  }

  const ordered = LOGICAL_SIDES.map(side => bySide.get(side));
  if (ordered.some(control => control === undefined)) return undefined;
  return ordered as readonly StyleControl[];
}

/** How a property's controls should be drawn, once the box question is settled. */
export interface SideBox {
  /** The controls in the order to draw them: box order when boxed. */
  readonly controls: readonly StyleControl[];
  /** Whether to draw a box at all. */
  readonly boxed: boolean;
  /**
   * The axes to put on the box, or `undefined` when it is not one.
   *
   * The EDITED ELEMENT's, so the grid's own placement resolves in them: columns
   * run along the inline axis, so column one is the inline start in either
   * direction and a vertical mode transposes the pair.
   */
  readonly axes: SideOrientation | undefined;
}

/**
 * Settle whether a property is drawn as a box, and in what order.
 *
 * A pure question, lifted out of the panel so the component reads as markup:
 * the four branches it replaces — is this per-side, is the orientation known,
 * which order do the controls go in, which side is this one — are one decision
 * with one answer, and each of them was a place the component could disagree
 * with itself.
 *
 * A box is drawn ONLY when its arrangement can be justified. The picture makes
 * a positional claim — this control is the leading edge — and the mapping from
 * a logical side to a physical one belongs to the element being edited. Unknown
 * orientation therefore keeps the rows, which name their side in words and are
 * true whichever way the element runs.
 *
 * @param controls - every control the property expanded into
 * @param orientation - the edited element's axes, or `undefined` if unreadable
 * @returns what to draw, and what to put on it
 */
export function sideBoxFor(
  controls: readonly StyleControl[],
  orientation: SideOrientation | undefined
): SideBox {
  const sides = logicalSideGroup(controls);
  if (sides === undefined || orientation === undefined) {
    return { controls, boxed: false, axes: undefined };
  }
  return { controls: sides, boxed: true, axes: orientation };
}

/**
 * The side one control draws in a box, or `undefined` outside one.
 *
 * @param box - the settled drawing decision
 * @param control - one of its controls
 * @returns the side name, for the stylesheet to place by
 */
export function sideOf(
  box: SideBox,
  control: StyleControl
): LogicalSide | undefined {
  if (!box.boxed) return undefined;
  const side = control.path[0];
  return side === undefined ? undefined : (side as LogicalSide);
}
