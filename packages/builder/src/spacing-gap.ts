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
 * Asked of the rendered page, for the reason the bands are: the cascade decides
 * which value wins, and an author's margin on the child (a node value or a
 * named class) beats the gap at any breakpoint. So the question is answered by
 * taking the block's own classes away for one synchronous read and putting them
 * back: if the margin is unchanged, nothing the author set on the block is
 * producing it, and in a flow container that holds it after another block, it
 * is the container's gap. The attribute is restored inside the same task, so
 * nothing paints and the canvas's mutation watch sees no net change.
 *
 * A host stylesheet rule on the element itself (`.content p { margin… }`) would
 * also survive the class removal and read as the gap. The canvas is drawn in
 * the site's own layout, so that is possible; it is also the case where the
 * published page shows the same space, and the band's number is still right.
 *
 * @module spacing-gap
 */

import {
  findNode,
  NAMED_CLASS_PREFIX,
  NODE_CLASS_PREFIX,
  CONTENT_WIDTH_CLASS,
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

/**
 * Whether a class is one the author's own spacing reaches the block through:
 * its node class or a named class. The block-type class, part classes and the
 * content-width class are defaults and stay on.
 */
function ownClass(name: string): boolean {
  if (name.startsWith(NAMED_CLASS_PREFIX)) return true;
  return name.startsWith(NODE_CLASS_PREFIX) && name !== CONTENT_WIDTH_CLASS;
}

/** Whether a computed `display` lays its children out with `gap`. */
function spacesWithGap(display: string): boolean {
  return /\b(?:flex|grid)\b/.test(display);
}

/**
 * The name of the container whose gap this block's block-start margin is, or
 * `undefined` when the margin is the block's own (or there is none to name).
 *
 * `lookup` is the resolver the canvas renders with, so the container's
 * `childGap` is read from the same definition that drew the page.
 */
export function gapOwnerOf(
  block: Element,
  document: BlockDocument,
  lookup: (type: string) => AnyBlockDefinition | undefined
): string | undefined {
  // `> * + *`: the first child is never spaced by its container.
  if (block.previousElementSibling === null) return undefined;
  const parent = block.parentElement;
  const parentId = parent?.getAttribute(NODE_ID_ATTRIBUTE);
  if (parent === null || parentId === null || parentId === undefined) {
    return undefined;
  }
  const container = findNode(document.nodes, parentId);
  if (container === undefined) return undefined;
  if (lookup(container.type)?.childGap === undefined) return undefined;
  const view = block.ownerDocument.defaultView;
  if (view === null) return undefined;
  // A flex or grid container spaces with `gap`, and its children's flow
  // margin is taken off; a margin there is the child's own.
  if (spacesWithGap(view.getComputedStyle(parent).display)) return undefined;

  const style = view.getComputedStyle(block);
  const side = blockStartSide(style.writingMode);
  const shown = marginOn(style, side);
  const classes = block.getAttribute("class");
  if (classes === null) return undefined;
  block.setAttribute(
    "class",
    classes
      .split(/\s+/)
      .filter(name => name !== "" && !ownClass(name))
      .join(" ")
  );
  let unset: string;
  try {
    unset = marginOn(view.getComputedStyle(block), side);
  } finally {
    block.setAttribute("class", classes);
  }
  return unset === shown ? layerLabel(container, lookup) : undefined;
}
