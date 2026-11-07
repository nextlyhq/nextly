/**
 * Whether a stored block's conditions decide who sees it, as the published
 * page judges it. Its own module, importing nothing of the editor's
 * controls, so Layers and the canvas can ask it without depending on them.
 *
 * @module condition-gate
 */
import {
  isConditionGated,
  storedVisibilityOf,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

/**
 * Whether a stored block's conditions decide who sees it, as the published
 * page judges it: through the engine's gate, with any placement gates a
 * stored document holds removed first, as the renderer removes them. The one
 * question the canvas badge, Layers and these checks all ask.
 */
export function gatedAsStored(node: BlockNode): boolean {
  return isConditionGated({ visibility: storedVisibilityOf(node.visibility) });
}

/**
 * Whether a block of a composed tree is drawn only for some visitors: its own
 * conditions, or the gates of the placements it was expanded from, which only
 * the tree a renderer composes holds and the page judges with the rest.
 */
export function gatedAsDrawn(node: BlockNode): boolean {
  return isConditionGated(node);
}
