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
 * A block type this runtime has NOT loaded looks the same from the lookup — no spec either way —
 * and is a different question. It is answered on the WRITE side, where `validate` rejects only when
 * a definition is present, so an unloaded plugin can never cost an author their content. On the
 * read side there is nothing to keep: the placeholder is all that renders.
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
  // An UNREGISTERED type contributes nothing to a READ. `RenderNode` draws its placeholder and
  // never traverses its children, so keeping them in the read copy only puts their rules — and any
  // URL in them — into a stylesheet for markup nobody receives.
  //
  // This does not lose anything: what protects an author's work is that the STORED document is
  // untouched, which is a property of this returning a copy, not of what the copy contains. The
  // write path is where the distinction between "unloaded plugin" and "undeclared slot" has to be
  // drawn, and it draws it — `validate` rejects only when a definition is present.
  if (!def) return [];
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
 *
 * 🔴 FOR READING ONLY. The result must never be written back: it is what a page should DISPLAY,
 * not what it should STORE, and the two differ for any block whose plugin this process has not
 * loaded. Repairing a stored document is a separate decision with its own author-facing surface.
 */
export function pruneUndeclaredSlots(
  node: BlockNode,
  registry: BlockRegistry
): BlockNode {
  const kept = declaredSlotEntries(node, registry);
  const storedNames = node.slots ? Object.keys(node.slots) : [];
  // A REORDER counts as a change, not only a drop. Comparing lengths alone leaves a node whose
  // slots are all declared but stored in another order untouched — so `declaredSlotEntries` would
  // answer in declared order while the tree every generic walker sees stayed in stored order, and
  // the two would disagree exactly where this normalisation is supposed to make them agree.
  let changed =
    kept.length !== storedNames.length ||
    kept.some(([name], i) => name !== storedNames[i]);
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
