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
 *
 * A block type this runtime has NOT loaded is a different case and keeps everything it holds. The
 * two look alike from the lookup — both give no spec — and only one is a statement about the
 * document.
 */
import type { BlockRegistry } from "./registry";
import type { BlockNode } from "./types";

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
  // An UNREGISTERED type keeps everything it holds. "This runtime has not loaded that plugin" and
  // "that block declares no such slot" are different statements, and only the second is a reason to
  // drop anything: a page rendered while a plugin is unloaded would otherwise lose the children of
  // every block that plugin owns — and because the pruned tree is what an editor would save next,
  // it would lose them permanently. `blocks-react` keeps the node and draws its unknown-block
  // placeholder for the same reason, so the two packages agree.
  //
  // Stored order is the only order available here; there is no declaration to take one from.
  if (!def) return Object.entries(stored);
  const entries: [string, BlockNode[]][] = [];
  for (const spec of def.slots ?? []) {
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
