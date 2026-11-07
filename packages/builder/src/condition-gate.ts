/**
 * Whether a stored block's conditions decide who sees it, as the published
 * page judges it. Its own module, importing nothing of the editor's
 * controls, so Layers and the canvas can ask it without depending on them.
 *
 * @module condition-gate
 */
import {
  isConditionGated,
  isPlainRecord,
  mapForest,
  storedVisibilityOf,
  type BlockDocument,
  type BlockNode,
  type ComponentLookup,
  type DefinitionsById,
  type NodeVisibility,
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

/**
 * The definitions as the renderer reads them: a placement gate stored in one,
 * as hand-edited or older data may hold, is removed, as the renderer removes
 * it, so a composition judges only the gates the resolver writes. Each one is
 * read on first use, so a large component library costs nothing until a page
 * places it.
 *
 * Rewritten with the engine's own forest rewrite, which keeps what it can't
 * walk as stored (nodes that are not a list, an entry that is not a block, a
 * slot that is not a list, a cycle), so malformed stored data reaches the
 * resolver to repair or refuse rather than throwing here first.
 */
export function asStoredDefinitions(
  definitions: DefinitionsById
): ComponentLookup {
  const read = new Map<string, BlockDocument | undefined>();
  return {
    has: id => definitions.has(id),
    get: id => {
      if (read.has(id)) return read.get(id);
      const definition = definitions.get(id);
      const stored =
        definition === undefined
          ? undefined
          : {
              ...definition,
              nodes: mapForest(definition.nodes, withoutPlacementGate),
            };
      read.set(id, stored);
      return stored;
    },
  };
}

/** One block with any placement gate stored on it removed. */
function withoutPlacementGate(node: BlockNode): BlockNode {
  if (
    !isPlainRecord(node.visibility) ||
    !Object.hasOwn(node.visibility, "within")
  ) {
    return node;
  }
  return {
    ...node,
    visibility: storedVisibilityOf(node.visibility) as NodeVisibility,
  };
}
