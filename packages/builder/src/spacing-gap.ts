/**
 * Whose space a block's block-start margin is: the block's own, or the gap of
 * the container holding it.
 *
 * A block carries no outer margin of its own. A container that declares a
 * `childGap` spaces every child after the first with a top margin, so the
 * computed style of that child reports the gap AS its margin, and a band
 * labelled with the number alone tells the author the child carries spacing it
 * does not. The overlay names the container instead: "Gap · from Section".
 *
 * Decided by which rule WINS, not by what the value is. Every rule the gap
 * decides is keyed on {@link CHILD_GAP_CLASS}, which the element holding it
 * wears, so taking that one class off for a synchronous read takes the gap out
 * of the cascade and changes nothing else: the container keeps its padding,
 * font size and every other default, so a margin an author wrote in `%` or `em`
 * resolves exactly as before. If the child's margin changes, the gap was the
 * rule applying; an author's margin outranks the gap and survives unchanged,
 * even when it is the same length or reads the same token. The attribute is
 * restored inside the same task, so nothing paints and the canvas's mutation
 * watch sees no net change.
 *
 * The element holding the rule is the block's parent. It is usually the
 * container's own element; inside a configured collection loop it is the
 * entry wrapper the loop draws around each repetition, which is no node of
 * its own, so the OWNER named is the nearest enclosing node: the loop.
 *
 * @module spacing-gap
 */

import {
  CHILD_GAP_CLASS,
  findNode,
  type AnyBlockDefinition,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

import { layerLabel } from "./layers";
import type { SpacingSide } from "./spacing-bands";

/** The physical side a block's `margin-block-start` lands on. */
export function blockStartSide(writingMode: string): SpacingSide {
  if (writingMode.startsWith("vertical-rl") || writingMode === "sideways-rl") {
    return "right";
  }
  if (writingMode.startsWith("vertical-lr") || writingMode === "sideways-lr") {
    return "left";
  }
  return "top";
}

/** The computed margin on one physical side, as the browser reports it. */
function marginOn(style: CSSStyleDeclaration, side: SpacingSide): string {
  switch (side) {
    case "top":
      return style.marginTop;
    case "right":
      return style.marginRight;
    case "bottom":
      return style.marginBottom;
    case "left":
      return style.marginLeft;
  }
}

/** Whether a computed `display` lays its children out with `gap`. */
function spacesWithGap(display: string): boolean {
  return /\b(?:flex|grid)\b/.test(display);
}

/**
 * The name of the container whose gap this block's block-start margin is, or
 * `undefined` when the margin is the block's own (or there is none to name).
 *
 * Whether the container HAS a gap is read from the compiled page alone: the
 * marker its element wears and the probe below. The compiler marks a container
 * for whichever source declared its gap, the block definition or the compile
 * context, so asking the definition again here would miss a gap only the
 * context declares. `lookup` is the resolver the canvas renders with, used
 * only to name the container.
 */
export function gapOwnerOf(
  block: Element,
  document: BlockDocument,
  lookup: (type: string) => AnyBlockDefinition | undefined
): string | undefined {
  // `> * + *`: the first child is never spaced by its container.
  if (block.previousElementSibling === null) return undefined;
  // The element the gap rule is keyed on, which must wear the marker.
  const holder = block.parentElement;
  if (holder === null || !holder.classList.contains(CHILD_GAP_CLASS)) {
    return undefined;
  }
  // The node that owns it: the holder itself, or the nearest node around it.
  const ownerId = holder
    .closest(`[${NODE_ID_ATTRIBUTE}]`)
    ?.getAttribute(NODE_ID_ATTRIBUTE);
  if (ownerId === null || ownerId === undefined) return undefined;
  const container = findNode(document.nodes, ownerId);
  if (container === undefined) return undefined;
  const view = block.ownerDocument.defaultView;
  if (view === null) return undefined;
  // A flex or grid holder spaces with `gap`, and its children's flow margin
  // is taken off; a margin there is the child's own.
  if (spacesWithGap(view.getComputedStyle(holder).display)) return undefined;

  const style = view.getComputedStyle(block);
  const side = blockStartSide(style.writingMode);
  const shown = marginOn(style, side);
  holder.classList.remove(CHILD_GAP_CLASS);
  let withoutGap: string;
  try {
    withoutGap = marginOn(view.getComputedStyle(block), side);
  } finally {
    holder.classList.add(CHILD_GAP_CLASS);
  }
  return withoutGap === shown ? undefined : layerLabel(container, lookup);
}
