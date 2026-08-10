/**
 * Finding the blocks an author cannot see but cannot save past.
 *
 * A stored document can carry children under a slot name the block's own definition never
 * declares — a slot a rename or a block update left behind. Saving such a page is now refused
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
}

/**
 * Whether a node's slots are judged at all.
 *
 * A type this build has no structure for is one the validator leaves to `allowUnknown` — a page
 * saved while a plugin is unloaded must not be reported as broken, because it is not. The reader
 * and this finder therefore have to agree, or the banner would list blocks that save perfectly.
 */
function declaredFor(
  node: BlockNode,
  registry: BlockRegistry
): readonly { name: string }[] | undefined {
  const def = registry.get(node.type);
  return def ? (def.slots ?? []) : declaredSlotsOf(node.type);
}

/**
 * Every block stored in a slot its parent does not declare, in document order.
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
    if (stored) {
      const declared = declaredFor(node, registry);
      for (const [slotName, children] of Object.entries(stored)) {
        const isDeclared =
          declared === undefined ||
          declared.some(spec => spec.name === slotName);
        for (const child of children) {
          if (!isDeclared) {
            found.push({
              node: child,
              type: child.type,
              parentId: node.id,
              parentType: node.type,
              slotName,
              path: [...ancestry, node.type].join(" → "),
            });
          }
          // Descend regardless: a declared slot can hold a container that has an undeclared one,
          // and an undeclared slot's children can too. Reporting only the outermost would leave
          // an author removing one block and being refused again by the next.
          walk(child, [...ancestry, node.type]);
        }
      }
    }
  };

  walk(root, []);
  return found;
}
