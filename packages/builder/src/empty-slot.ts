/**
 * What "an empty container" means, in the two places the editor has to ask.
 *
 * {@link emptySlotOf} answers it about a stored NODE: which of a block's
 * declared regions is empty. Asked by two callers that must agree — the
 * inserter, deciding whether a new block goes INSIDE the selection or beside
 * it, and the canvas appender, deciding which containers to offer a "+" for. A
 * second copy of it would agree on the day it was written and drift afterwards,
 * and the drift would be silent because an appender offering to fill a
 * container the inserter then fills elsewhere looks correct from both sides.
 *
 * {@link EMPTY_CONTAINER_SELECTOR} answers it about a RENDERED element: which
 * elements the editor draws an empty-container affordance on. Both the
 * stylesheet's dashed box and the appender's control read it, for the same
 * reason the two callers above share `emptySlotOf`.
 *
 * @module empty-slot
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";
import { SLOTS_ATTRIBUTE } from "@nextlyhq/blocks-react";

import type { SlotSource } from "./inserter";
import {
  BUILDER_CHROME_CLASS,
  CANVAS_ROOT_CLASS,
  EMPTY_ELEMENTS_ATTRIBUTE,
} from "./shell-state";

/**
 * The rendered element an empty-container affordance may be drawn on.
 *
 * `builder-chrome.css` gives exactly this selector the 44px dashed box that
 * makes an otherwise sizeless container visible, and the canvas appender draws
 * its "+" on exactly the elements it matches. ONE spelling, asked by both,
 * rather than each deciding for itself which containers it covers.
 *
 * The two used to differ, and the difference was not visible from either side.
 * The appender drew for any node whose first declared slot was empty
 * ({@link emptySlotOf} below), which is a question about the DOCUMENT; the
 * stylesheet asks a question about the RENDER. A block whose root element
 * carries content of its own — `core/accordion-item` renders a `<summary>`
 * beside its slot — has an empty slot and a root that is not `:empty`, so the
 * stylesheet declined it and the appender did not. The appender was then
 * placing a fixed-size control on a container that had been given no box to
 * place it in, and on a root measuring less than the control it centred there.
 *
 * ## The WHOLE rule, not the element-level part of it
 *
 * All three conditions are here, because all three decide whether a box is
 * drawn and the affordance is only correct where one is:
 *
 * - inside a builder shell ({@link BUILDER_CHROME_CLASS}). A consumer can
 *   compose the exported appender with a bare `Canvas` and no shell at all —
 *   the product path does not, since `BlocksField` mounts the canvas inside
 *   `BuilderShell`, but nothing stops a host or a harness doing it. The rule
 *   then never applies, the container keeps its natural size of nothing, and a
 *   control drawn on the element-level match alone is a focusable button with
 *   no area: reachable by keyboard, announced by name, and invisible. That is
 *   the same defect declining an unrendered container removed, arriving through
 *   a partial condition.
 * - not asked to hide empty-element chrome ({@link EMPTY_ELEMENTS_ATTRIBUTE}).
 * - inside a canvas ({@link CANVAS_ROOT_CLASS}).
 *
 * The last two are additionally answered elsewhere for the appender — it
 * measures nothing outside a canvas root, and the shell hands it the same
 * preference through its `hidden` prop — and they stay in the selector anyway,
 * because this is the stylesheet's rule rather than a subset of it chosen for
 * the appender. `Element.matches` evaluates ancestors, so asking it of the
 * element the stylesheet would ask it of gets the same answer the browser gives
 * the rule.
 *
 * A stylesheet cannot import a constant, so `builder-chrome.css` spells this
 * out and `builder-chrome-attributes.test.ts` is what holds the two in step.
 *
 * `:empty` is asked of the element carrying {@link SLOTS_ATTRIBUTE}, which is
 * the same element that carries `NODE_ID_ATTRIBUTE` — `block-boundary.tsx`
 * applies both markers to a block's single root — so the element found by node
 * id is the element this question is about, with no second address to resolve.
 */
export const EMPTY_CONTAINER_SELECTOR =
  `.${BUILDER_CHROME_CLASS}:not([${EMPTY_ELEMENTS_ATTRIBUTE}="hidden"]) ` +
  `.${CANVAS_ROOT_CLASS} [${SLOTS_ATTRIBUTE}]:empty`;

/**
 * The block's first declared slot, when it holds nothing.
 *
 * FIRST rather than any: a block with several regions has an order, and the
 * one an author means by "inside this" is the one it declares first. Answering
 * with some other empty region would put content where nobody pointed.
 *
 * @param node - the node to inspect
 * @param slots - what each block type declares; absent means nothing is known
 * @returns the slot's name, or `null` when this is not an empty container
 */
export function emptySlotOf(
  node: BlockNode,
  slots: SlotSource | undefined
): string | null {
  const declared = slots?.slotsOf(node.type);
  const first = declared?.[0];
  if (first === undefined) return null;
  return (node.slots?.[first]?.length ?? 0) === 0 ? first : null;
}
