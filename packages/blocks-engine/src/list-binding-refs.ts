/**
 * Pointing an item binding's `list` at wherever that list's node ended up.
 *
 * A binding that names the enclosing list it reads (`list`) holds a NODE id,
 * and every copier mints node ids: duplicating a block, pasting, saving a
 * selection, inlining a component into an instance, drawing an entry's blocks
 * inside its template. A copy of an outer list that keeps its headings naming
 * the original list leaves them inside a list they do not name, so they draw
 * their fallback and a save refuses them. Each copier therefore hands its map
 * of old ids to new ones here.
 *
 * Only a list THIS copy re-identified is followed. A binding naming a list
 * outside the copied nodes (the page's list around a pasted block) still names
 * that list, which is still around it.
 *
 * @module list-binding-refs
 */
import type { BlockNode } from "./document";
import { remapEachBinding } from "./fragment-refs";
import { isPlainRecord } from "./plain-record";
import { ownEntry } from "./safe-record";

/** Old node id → new node id, as a copier records them. */
type NodeIdMap = Pick<ReadonlyMap<string, string>, "get" | "size">;

/**
 * A node's bindings with each `list` this copy re-identified pointed at the
 * copy. The input itself when nothing moved, so an ordinary node is not
 * reallocated; anything that is not a binding record is passed through.
 */
export function remapListBindings(
  bindings: unknown,
  nodeIds: NodeIdMap
): unknown {
  if (nodeIds.size === 0) return bindings;
  return remapEachBinding(bindings, (_prop, binding) =>
    withRemappedList(binding, nodeIds)
  );
}

/** One binding, its `list` following the copy when the copy moved it. */
function withRemappedList(binding: unknown, nodeIds: NodeIdMap): unknown {
  if (!isPlainRecord(binding)) return binding;
  const list = ownEntry(binding, "list");
  if (typeof list !== "string") return binding;
  const moved = nodeIds.get(list);
  return moved === undefined || moved === list
    ? binding
    : { ...binding, list: moved };
}

/**
 * One copied node with its bindings' lists following the copy. The node
 * itself when nothing moved; `bindings` is only written when it changed, so a
 * node with none gains no key holding `undefined`.
 */
export function withListsRelinked(
  node: BlockNode,
  nodeIds: NodeIdMap
): BlockNode {
  if (node.bindings === undefined) return node;
  const bindings = remapListBindings(node.bindings, nodeIds);
  return bindings === node.bindings
    ? node
    : { ...node, bindings: bindings as BlockNode["bindings"] };
}
