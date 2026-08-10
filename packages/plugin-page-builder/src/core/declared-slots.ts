/**
 * Slots a block's own definition declares, and the pruning that holds readers to them.
 *
 * A stored document can carry children under a slot name the definition never declared — a slot
 * that was renamed, or removed in a block update. Nothing rejected it at write until now, and both
 * readers walked every STORED slot rather than the declared ones, so those children were compiled
 * into the stylesheet and their asset URLs shipped for markup nobody receives.
 *
 * The allowlist a definition puts on a slot (`allowedBlocks`) is a promise the block author made
 * about what can live there. A slot the definition does not declare has no allowlist at all, so
 * every child in it was unchecked — and the containment was retroactively wrong too: the day a
 * definition declares that name again, children that were never checked become live.
 */
import type { BlockRegistry } from "./registry";
import type { BlockNode } from "./types";

/**
 * Whether a node's definition declares this slot name.
 *
 * An UNREGISTERED block type is treated as declaring nothing. That is deliberate and matches the
 * write side: a document may legitimately hold types this runtime has not loaded, and the honest
 * answer for one is "this reader cannot say what belongs here", which reads the same as an
 * undeclared slot. The permissive direction is the one a caller opts into with `allowUnknown`.
 */
export function declaresSlot(
  node: BlockNode,
  slotName: string,
  registry: BlockRegistry
): boolean {
  const def = registry.get(node.type);
  return !!def?.slots?.some(spec => spec.name === slotName);
}

/**
 * The entries of `node.slots` the node's definition actually declares, in DECLARED order.
 *
 * Declared order rather than stored order, so this package answers the question the SEO deriver in
 * `blocks-react` already answers that way. Two packages disagreeing about which child comes first
 * is how one of them ends up describing a page the other renders.
 */
export function declaredSlotEntries(
  node: BlockNode,
  registry: BlockRegistry
): [string, BlockNode[]][] {
  const stored = node.slots;
  if (!stored) return [];
  const def = registry.get(node.type);
  if (!def?.slots) return [];
  const entries: [string, BlockNode[]][] = [];
  for (const spec of def.slots) {
    const children = stored[spec.name];
    if (children) entries.push([spec.name, children]);
  }
  return entries;
}

/**
 * A copy of the tree holding only the slots each node's definition declares.
 *
 * Done once at the entry point rather than by teaching every walk to check: `walk` has thirty call
 * sites and no registry, and a rule enforced at thirty places is a rule that is eventually missed
 * at one. Everything downstream — the style compiler, the class map, the renderer — then sees a
 * tree that cannot contain an undeclared slot, so none of them has to remember.
 *
 * Returns the SAME node object when nothing was dropped, so a document with no undeclared slots is
 * not rebuilt and callers comparing by identity keep working.
 */
export function pruneUndeclaredSlots(
  node: BlockNode,
  registry: BlockRegistry
): BlockNode {
  const kept = declaredSlotEntries(node, registry);
  const storedCount = node.slots ? Object.keys(node.slots).length : 0;
  let changed = kept.length !== storedCount;
  const slots: Record<string, BlockNode[]> = {};
  for (const [name, children] of kept) {
    const pruned = children.map(child => pruneUndeclaredSlots(child, registry));
    // Compared per child rather than by array identity: `map` always returns a new array, so
    // testing the array would report a change for every node that has any children at all.
    if (pruned.some((child, i) => child !== children[i])) changed = true;
    slots[name] = pruned;
  }
  if (!changed) return node;
  return node.slots ? { ...node, slots } : node;
}
