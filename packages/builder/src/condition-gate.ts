/**
 * Whether a stored block's conditions decide who sees it, as the published
 * page judges it. Its own module, importing nothing of the editor's
 * controls, so Layers and the canvas can ask it without depending on them.
 *
 * @module condition-gate
 */
import {
  DEFAULT_LIMITS,
  isConditionGated,
  storedVisibilityOf,
  type BlockNode,
  type ComponentLookup,
  type DefinitionsById,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import { repairingLookup } from "@nextlyhq/blocks-react";

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

/**
 * The definitions as the renderer reads them, so the canvas's marks and the
 * conditions it can't check compose exactly the tree the canvas draws. It is
 * the renderer's own repairing lookup, not a copy of it: a placement gate
 * stored in a definition, as hand-edited or older data may hold, is removed;
 * an entry that is not a block is dropped before it counts against the page's
 * node budget; a tree past the limits is read no further than the renderer
 * reads it; and a definition it can't read at all is reported unreadable by
 * the resolver rather than throwing here. Each one is read on demand, so a
 * large component library costs nothing until a page places it.
 */
export function asStoredDefinitions(
  definitions: DefinitionsById,
  limits?: DocumentLimits
): ComponentLookup {
  return repairingLookup(definitions, limits ?? DEFAULT_LIMITS);
}
