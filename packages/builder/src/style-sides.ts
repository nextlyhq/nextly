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
