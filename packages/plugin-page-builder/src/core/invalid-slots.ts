/**
 * Finding what an author cannot see but cannot save past.
 *
 * A stored document can carry a slot name the block's own definition never declares — a slot a
 * rename or a block update left behind. Saving such a page is refused (`validate.ts`), and that is
 * the point: the allowlist a definition puts on a slot is a promise, and an undeclared slot has no
 * allowlist at all.
 *
 * The problem this module exists for is what the author experiences. Anything under such a slot is
 * **invisible in the editor**: the canvas builds every stored slot, but a block's `render` places
 * only the slots it declares, so nothing draws it. The author sees a page that looks correct,
 * presses save, and is refused — with no element to select and nothing to delete.
 *
 * So the editor needs a list that does not come from the canvas. This finds it.
 *
 * What is reported is whatever the write path refuses, and it is NOT always a block. Validation
 * refuses a slot's NAME rather than its contents, and refuses a slots map on a non-container
 * before it reads a single key, so a page can be unsaveable with nothing in it to remove. Each of
 * those states needs its own repair or the banner reports a problem the author cannot act on.
 *
 * @module core/invalid-slots
 */
import { declaredSlotsOf } from "./block-structure";
import type { BlockRegistry } from "./registry";
import { dropSlots, findNode, removeFromSlot, removeSlot } from "./tree";
import type { BlockNode } from "./types";

/** Where a fault sits, and how to say so to someone who cannot click on it. */
interface InvalidSlotLocation {
  /** Stable identity for a list row, and for telling two faults apart. */
  key: string;
  /** The block holding the fault. */
  parentId: string;
  /** Its type, so a row can say where the fault sits. */
  parentType: string;
  /**
   * Human-readable path from the document root, e.g. `core/container → core/row`.
   *
   * The author cannot select any of this, so a location they can read is the only orientation a
   * row can offer.
   */
  path: string;
}

/**
 * One thing standing between the document and a successful save.
 *
 * A union rather than one shape with optional fields: the three cases need three different
 * repairs, and a `node` that is sometimes absent would let a caller forget which case it holds.
 */
export type InvalidSlotEntry =
  | (InvalidSlotLocation & {
      /** A block sitting in a slot its parent does not declare. */
      kind: "block";
      slotName: string;
      node: BlockNode;
      type: string;
      /**
       * How many further blocks sit inside this one.
       *
       * Removing it removes its whole subtree, and a count of zero reads very differently from a
       * count of forty. Someone deciding whether to discard something they cannot look at is owed
       * the size of it.
       */
      descendantCount: number;
    })
  | (InvalidSlotLocation & {
      /**
       * A slot nothing declares that holds nothing either.
       *
       * Still refused, because the name is what validation rejects. There is no child to address,
       * so the repair is the slot itself — and removing it discards no content at all.
       */
      kind: "empty-slot";
      slotName: string;
    })
  | (InvalidSlotLocation & {
      /**
       * A block that may hold no slots at all, carrying an empty slots map.
       *
       * Validation refuses any slots object on a definition that is not a container before it
       * looks at the keys, so with no keys left there is no narrower thing to remove.
       */
      kind: "stray-slots";
    });

/**
 * Whether a node's slot NAMES are judged at all.
 *
 * A type this build has no structure for is one the validator leaves to `allowUnknown` — a page
 * saved while a plugin is unloaded must not be reported as broken, because it is not. The reader
 * and this finder therefore have to agree, or the banner would list blocks that save perfectly.
 *
 * The branch is on the SOURCE rather than a fallback: a registered definition is the whole answer
 * about its own slots, including when it declares none, so a `??` here would let a built-in's
 * structure answer for a definition that deliberately exposes nothing.
 */
function declaredFor(
  node: BlockNode,
  registry: BlockRegistry
): readonly { name: string }[] | undefined {
  const def = registry.get(node.type);
  return def ? (def.slots ?? []) : declaredSlotsOf(node.type);
}

/**
 * Whether this block may hold no slots whatsoever.
 *
 * Only a REGISTERED definition can say so. Without one the validator never reaches that check, so
 * an unregistered block carrying an empty map saves and must not be reported.
 */
function forbidsSlotsEntirely(
  node: BlockNode,
  registry: BlockRegistry
): boolean {
  const def = registry.get(node.type);
  return def !== undefined && !def.isContainer;
}

/** Blocks beneath this one, not counting it. */
function countDescendants(node: BlockNode): number {
  let total = 0;
  for (const children of Object.values(node.slots ?? {})) {
    for (const child of children) total += 1 + countDescendants(child);
  }
  return total;
}

/**
 * Everything that makes a document unsaveable for slot reasons, in document order.
 *
 * Only the OUTERMOST offending block in any branch is reported, because entries are removal
 * targets and removing one takes its subtree with it. Reporting a block that already sits inside a
 * reported block would offer a second Remove with nothing left to act on, and would inflate the
 * count with blocks nobody has to decide about separately. Descent therefore continues through
 * declared slots — where a nested container can hide an undeclared slot of its own that no other
 * entry would remove — and stops at each block that becomes an entry.
 *
 * Document order rather than grouped by parent: a reader meets them as they would going down the
 * page, which is the only ordering they can map onto anything.
 */
export function findInvalidSlotEntries(
  root: BlockNode,
  registry: BlockRegistry
): InvalidSlotEntry[] {
  const found: InvalidSlotEntry[] = [];

  const walk = (node: BlockNode, ancestry: string[]): void => {
    const stored = node.slots;
    if (!stored) return;

    const here = [...ancestry, node.type];
    const path = here.join(" → ");
    const at = { parentId: node.id, parentType: node.type, path };
    const slotNames = Object.entries(stored);

    // A map with no keys left on a block that may hold none: refused, and with no key there is
    // nothing narrower to address than the map itself.
    if (slotNames.length === 0) {
      if (forbidsSlotsEntirely(node, registry)) {
        found.push({ ...at, key: `slots:${node.id}`, kind: "stray-slots" });
      }
      return;
    }

    const declared = declaredFor(node, registry);

    for (const [slotName, children] of slotNames) {
      const isDeclared =
        declared === undefined || declared.some(spec => spec.name === slotName);

      if (isDeclared) {
        for (const child of children) walk(child, here);
        continue;
      }

      if (children.length === 0) {
        found.push({
          ...at,
          key: `slot:${node.id}:${slotName}`,
          kind: "empty-slot",
          slotName,
        });
        continue;
      }

      for (const child of children) {
        found.push({
          ...at,
          key: `block:${child.id}`,
          kind: "block",
          slotName,
          node: child,
          type: child.type,
          descendantCount: countDescendants(child),
        });
      }
    }
  };

  walk(root, []);
  return found;
}

/**
 * Apply one entry's repair, returning a new tree.
 *
 * Lives beside the finder rather than in the editor because the mapping from a fault to its cure
 * is a property of the fault: three kinds need three different operations, and a caller choosing
 * for itself is a caller that can choose wrong. The editor's action for a row is checked against
 * this, so the two cannot drift.
 */
export function repairInvalidSlot(
  root: BlockNode,
  entry: InvalidSlotEntry,
  registry: BlockRegistry
): BlockNode {
  const declared = declaredSlotNames(root, entry.parentId, registry);
  switch (entry.kind) {
    case "block":
      return removeFromSlot(
        root,
        entry.parentId,
        entry.slotName,
        entry.node.id,
        declared
      );
    case "empty-slot":
      return removeSlot(root, entry.parentId, entry.slotName, declared);
    case "stray-slots":
      return dropSlots(root, entry.parentId);
  }
}

/**
 * The slot names a node's definition declares, for settling its slots after a repair.
 *
 * `undefined` when nothing in this build describes the type, which is the same "leave it alone"
 * answer the validator gives such a block. Exported because the editor's reducer has to settle the
 * same way the core does, and deriving it twice is how the two would come to disagree.
 */
export function declaredSlotNames(
  root: BlockNode,
  parentId: string,
  registry: BlockRegistry
): readonly string[] | undefined {
  const parent = findNode(root, parentId);
  if (!parent) return undefined;
  return declaredFor(parent, registry)?.map(spec => spec.name);
}
