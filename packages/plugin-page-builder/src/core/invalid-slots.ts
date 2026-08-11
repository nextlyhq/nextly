/**
 * Finding the blocks an author cannot see but cannot save past.
 *
 * A stored document can carry children under a slot name the block's own definition never
 * declares — a slot a rename or a block update left behind. Saving such a page is refused
 * (`validate.ts`), and that is the point: the allowlist a definition puts on a slot is a promise,
 * and an undeclared slot has no allowlist at all.
 *
 * The problem this module exists for is what the author experiences. Those children are
 * **invisible in the editor**: the canvas builds every stored slot, but a block's `render` places
 * only the slots it declares, so nothing draws them. The author sees a page that looks correct,
 * presses save, and is refused — with no element to select and nothing to delete.
 *
 * So the editor needs a list of them that does not come from the canvas. This finds it.
 *
 * @module core/invalid-slots
 */
import { declaredSlotsOf } from "./block-structure";
import type { BlockRegistry } from "./registry";
import type { BlockNode } from "./types";

/** One block sitting in a slot its parent does not declare. */
export interface InvalidSlotEntry {
  /** The child block itself — what a Remove action addresses. */
  node: BlockNode;
  /** The block type of the child, for the label. */
  type: string;
  /** The container holding it. */
  parentId: string;
  /** The container's type, so the label can say where the block sits. */
  parentType: string;
  /** The slot name its definition does not declare. */
  slotName: string;
  /**
   * Human-readable path from the document root, e.g. `core/container → core/row`.
   *
   * The author cannot select these blocks, so a location they can read is the only orientation
   * the banner can offer.
   */
  path: string;
  /**
   * How many further blocks sit inside this one.
   *
   * Removing an entry removes its whole subtree, and a count of zero reads very differently from
   * a count of forty. An author deciding whether to discard something they cannot look at is
   * owed the size of it.
   */
  descendantCount: number;
}

/**
 * Whether a node's slots are judged at all.
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

/** Blocks beneath this one, not counting it. */
function countDescendants(node: BlockNode): number {
  let total = 0;
  for (const children of Object.values(node.slots ?? {})) {
    for (const child of children) total += 1 + countDescendants(child);
  }
  return total;
}

/**
 * Every block stored in a slot its parent does not declare, in document order.
 *
 * Only the OUTERMOST such block in any branch is reported, because the entries are removal
 * targets and removing one takes its subtree with it. Reporting a block that already sits inside
 * a reported block would offer the author a second Remove that had nothing left to act on, and
 * would inflate the count with blocks nobody has to decide about separately. Descent therefore
 * continues through declared slots — where a nested container can hide an undeclared slot of its
 * own that no other entry would remove — and stops at each block that becomes an entry.
 *
 * Document order rather than grouped by parent: the banner lists them as the author would meet
 * them going down the page, which is the only ordering they can map onto anything.
 */
export function findInvalidSlotEntries(
  root: BlockNode,
  registry: BlockRegistry
): InvalidSlotEntry[] {
  const found: InvalidSlotEntry[] = [];

  const walk = (node: BlockNode, ancestry: string[]): void => {
    const stored = node.slots;
    if (!stored) return;

    const declared = declaredFor(node, registry);
    const here = [...ancestry, node.type];

    for (const [slotName, children] of Object.entries(stored)) {
      const isDeclared =
        declared === undefined || declared.some(spec => spec.name === slotName);

      for (const child of children) {
        if (isDeclared) {
          walk(child, here);
          continue;
        }
        found.push({
          node: child,
          type: child.type,
          parentId: node.id,
          parentType: node.type,
          slotName,
          path: here.join(" → "),
          descendantCount: countDescendants(child),
        });
      }
    }
  };

  walk(root, []);
  return found;
}
