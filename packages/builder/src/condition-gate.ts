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
  isPlainRecord,
  storedVisibilityOf,
  type BlockDocument,
  type BlockNode,
  type ComponentLookup,
  type DefinitionsById,
  type DocumentLimits,
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
 */
export function asStoredDefinitions(
  definitions: DefinitionsById,
  limits?: Pick<DocumentLimits, "maxDepth">
): ComponentLookup {
  const deepest = (limits?.maxDepth ?? DEFAULT_LIMITS.maxDepth) + 1;
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
              nodes: withoutPlacementGates(definition.nodes, deepest),
            };
      read.set(id, stored);
      return stored;
    },
  };
}

/**
 * A forest with any stored placement gate removed. Past the deepest tree a
 * definition may hold it is left as it is: the resolver refuses a definition
 * that deep, so nothing below is drawn.
 */
function withoutPlacementGates(
  nodes: readonly BlockNode[],
  levelsLeft: number
): BlockNode[] {
  if (levelsLeft <= 0) return [...nodes];
  return nodes.map(node => {
    const next: BlockNode = { ...node };
    if (
      isPlainRecord(node.visibility) &&
      Object.hasOwn(node.visibility, "within")
    ) {
      next.visibility = storedVisibilityOf(node.visibility) as NodeVisibility;
    }
    if (isPlainRecord(node.slots)) {
      const slots: Record<string, BlockNode[]> = {};
      for (const [name, children] of Object.entries(node.slots)) {
        // A slot that is not a list holds no blocks the resolver reads.
        if (Array.isArray(children)) {
          slots[name] = withoutPlacementGates(children, levelsLeft - 1);
        }
      }
      next.slots = slots;
    }
    return next;
  });
}
