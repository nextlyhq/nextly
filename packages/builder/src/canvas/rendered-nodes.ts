/**
 * The rendered page's node elements, read from the marker the renderer puts on
 * them.
 *
 * Its own module so the canvas and the geometry watch every overlay shares can
 * both import it without importing each other.
 *
 * @module rendered-nodes
 */

import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";

/**
 * Every element the renderer marked as a node, in document order.
 *
 * The companion of the canvas's `nodeElement`: both answer from the same marker,
 * and a caller that needs all of them should not walk the tree with its own
 * selector.
 *
 * Chrome drawn INSIDE the canvas root carries no node marker, so it is excluded
 * by construction rather than by a filter that would have to be kept in step
 * with whatever chrome arrives next.
 */
export function nodeElements(root: HTMLElement): readonly Element[] {
  const found: Element[] = [];
  // `forEach` rather than `for…of`: a `NodeList` is only iterable under a lib
  // that declares its iterator, and this package compiles without one.
  root.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`).forEach(element => {
    found.push(element);
  });
  return found;
}

/**
 * The node elements in a subtree, the subtree's own root included: what a
 * node arriving in the rendered tree brings with it, or takes with it when it
 * leaves.
 */
export function nodeElementsIn(subtree: Element): readonly Element[] {
  const found: Element[] = subtree.hasAttribute(NODE_ID_ATTRIBUTE)
    ? [subtree]
    : [];
  subtree.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`).forEach(element => {
    found.push(element);
  });
  return found;
}
