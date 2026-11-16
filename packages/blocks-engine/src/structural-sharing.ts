/**
 * Rebuilding a forest without copying what an edit did not touch.
 *
 * Documents are immutable values, so an edit can share every part it did not
 * change with the document before it. Then only the path from the edit to the
 * root is new, and anything kept against a part (its measured size, in
 * `kept-sizes`) still holds for it. The tree primitives and the op layer
 * rebuild through these helpers so they agree on what "unchanged" means.
 *
 * @module structural-sharing
 */
import type { BlockNode } from "./document";
import { defineEntry } from "./safe-record";

/** Whether two lists hold the same entries, by identity, in the same order. */
export function sameEntries(a: readonly unknown[], b: unknown): boolean {
  return (
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((entry, index) => entry === b[index])
  );
}

/** A rebuilt child list, or the original when it holds the same children. */
export function keptList(
  rebuilt: BlockNode[] | undefined,
  original: BlockNode[]
): BlockNode[] {
  return rebuilt === undefined || sameEntries(rebuilt, original)
    ? original
    : rebuilt;
}

/**
 * Put the rebuilt slots back on a node, keeping any slot that was not rebuilt.
 *
 * What did not change keeps its identity. A rebuilt child list holding exactly
 * the children it held before is the original list, and a node `fn` left alone
 * whose lists all came back unchanged is the original node. Documents are
 * immutable values, so an edit then shares every part it did not touch with
 * the document before it: only the path from the edit to the root is new, and
 * anything kept against a part (a measured size) still holds for it.
 */
export function assembleSlots(
  source: unknown,
  mapped: BlockNode,
  built: Map<string, BlockNode[]>
): BlockNode {
  const slots: Record<string, BlockNode[]> = {};
  let changed = mapped !== source;
  for (const [name, original] of Object.entries(mapped.slots ?? {})) {
    // A slot absent from `built` held something this rebuild could not walk.
    // Keeping the stored value is the point: an unrelated edit must not be the
    // thing that destroys it.
    const value = keptList(built.get(name), original);
    if (value !== original) changed = true;
    // DEFINED rather than assigned — the write-side twin of reading through a
    // `Map` above. `safe-record` carries why; it is shared because fixing this
    // one site left three others in the package with the plain-assignment form.
    defineEntry(slots, name, value);
  }
  return changed ? { ...mapped, slots } : mapped;
}
