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
 * One reported fault is NOT invisible, and it is included anyway: a child of a type its slot's
 * allowlist refuses. That block draws on the canvas and can be selected, so the author can see it
 * — what they cannot see is why the page will not save, and there is nothing on the block to tell
 * them. Its repair is also the only one that need not destroy anything, since a slot admitting a
 * single container type says exactly what to put around the block instead.
 *
 * @module core/invalid-slots
 */
import { declaredParentsOf, declaredSlotsOf } from "./block-structure";
import { createNode, type BlockRegistry } from "./registry";
import {
  dropSlots,
  findNode,
  removeFromSlot,
  removeSlot,
  wrapInSlot,
} from "./tree";
import { DEFAULT_SLOT, type BlockNode, type SlotSpec } from "./types";

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
 * A union rather than one shape with optional fields: each case needs its own repair, and a `node`
 * that is sometimes absent would let a caller forget which case it holds.
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
    })
  | (InvalidSlotLocation & {
      /**
       * A block sitting in a slot its parent DOES declare, of a type that slot does not admit.
       *
       * The odd one out, and the difference matters to what the author is told: the slot exists,
       * so the canvas draws this block and they can point at it. What they cannot do is save,
       * and nothing on the block says why.
       */
      kind: "not-allowed";
      slotName: string;
      node: BlockNode;
      type: string;
      descendantCount: number;
      /**
       * The type to put around it instead of deleting it, when the slot leaves no ambiguity.
       *
       * Set only where the allowlist names exactly ONE type, that type can hold children, and its
       * own default slot admits this block — so there is a single correct answer rather than a
       * choice being made on the author's behalf. `undefined` means removal is the only repair.
       */
      wrapWith?: string;
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
): readonly SlotSpec[] | undefined {
  const def = registry.get(node.type);
  return def ? (def.slots ?? []) : declaredSlotsOf(node.type);
}

/**
 * The one type that could hold this child inside a restricted slot, if there is exactly one.
 *
 * The slot must permit exactly ONE type, so nothing is being chosen on the author's behalf; the
 * rest of the question — can that type hold this block at all — is {@link wrapperIfItHolds}, which
 * the mirror below asks in the same words.
 */
function soleWrapperFor(
  spec: SlotSpec,
  childType: string,
  registry: BlockRegistry
): string | undefined {
  const permitted = spec.allowedBlocks;
  if (!permitted || permitted.length !== 1) return undefined;
  return wrapperIfItHolds(permitted[0], childType, registry);
}

/**
 * The one type that could carry this child into a slot it is not allowed to sit in directly.
 *
 * The mirror of {@link soleWrapperFor}, reading the CHILD's restriction rather than the slot's:
 * a block naming exactly one permitted parent says precisely what to put around it. A stray
 * `core/column` in an ordinary container becomes a one-column row, which is what the author was
 * describing whether or not the document ever said so.
 *
 * Only when the outer slot will actually take that wrapper — otherwise the repair moves the
 * refusal up a level instead of resolving it.
 */
function soleParentWrapperFor(
  spec: SlotSpec | undefined,
  childType: string,
  registry: BlockRegistry
): string | undefined {
  const parents = declaredParentsOf(childType);
  if (!parents || parents.length !== 1) return undefined;
  const wrapperType = parents[0];
  if (spec?.allowedBlocks && !spec.allowedBlocks.includes(wrapperType)) {
    return undefined;
  }
  return wrapperIfItHolds(wrapperType, childType, registry);
}

/**
 * `wrapperType` when it is a container whose default slot would take `childType`, else `undefined`.
 *
 * Three ways of guessing wrong, removed once for both callers: a type that holds no children at
 * all; a default slot whose own allowlist excludes this block; and a block whose declared parents
 * do not include the wrapper. Each would produce a document that is still refused, while the
 * banner reported the repair as done.
 */
function wrapperIfItHolds(
  wrapperType: string,
  childType: string,
  registry: BlockRegistry
): string | undefined {
  const def = registry.get(wrapperType);
  const slots = def ? (def.slots ?? []) : declaredSlotsOf(wrapperType);
  if (!slots) return undefined;
  if (def && !def.isContainer) return undefined;

  const inner = slots.find(s => s.name === DEFAULT_SLOT);
  if (!inner) return undefined;
  if (inner.allowedBlocks && !inner.allowedBlocks.includes(childType)) {
    return undefined;
  }
  // And the CHILD's own restriction, which the inner slot's allowlist cannot express. A block that
  // may only sit under one parent is not made placeable by a wrapper that accepts everything.
  const childParents = declaredParentsOf(childType);
  if (childParents && !childParents.includes(wrapperType)) return undefined;
  return wrapperType;
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
      const spec = declared?.find(s => s.name === slotName);
      const isDeclared = declared === undefined || spec !== undefined;

      if (isDeclared) {
        for (const child of children) {
          // A DECLARED slot can still hold a child its allowlist refuses, and the write path
          // refuses the document for it exactly as it does for an undeclared slot name. Reported
          // here rather than only enforced, because this is the one fault the author can see and
          // still cannot act on: the block draws, so nothing about it says why saving fails.
          const parents = declaredParentsOf(child.type);
          if (parents && !parents.includes(node.type)) {
            // Refused by the write path exactly as an allowlist violation is, and reported in the
            // same shape: a block the author can see, on a page that will not save, with nothing
            // on the block to say why.
            found.push({
              ...at,
              key: `not-allowed:${child.id}`,
              kind: "not-allowed",
              slotName,
              node: child,
              type: child.type,
              descendantCount: countDescendants(child),
              wrapWith: soleParentWrapperFor(spec, child.type, registry),
            });
            continue;
          }
          if (spec?.allowedBlocks && !spec.allowedBlocks.includes(child.type)) {
            found.push({
              ...at,
              key: `not-allowed:${child.id}`,
              kind: "not-allowed",
              slotName,
              node: child,
              type: child.type,
              descendantCount: countDescendants(child),
              wrapWith: soleWrapperFor(spec, child.type, registry),
            });
            // Not descended into, for the same reason an undeclared block is not: this entry is
            // the repair target, and anything beneath it is settled by whichever repair is taken.
            continue;
          }
          walk(child, here);
        }
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
    case "not-allowed":
      // Wrapping keeps the block and its subtree; removal is the fallback for a slot whose
      // allowlist offers no single type that could hold it.
      return entry.wrapWith
        ? wrapInSlot(
            root,
            entry.parentId,
            entry.slotName,
            entry.node.id,
            child =>
              // Through the shared constructor, so the wrapper starts with everything its own
              // definition promises rather than with whatever this call remembered to pass.
              createNode(entry.wrapWith!, registry, { [DEFAULT_SLOT]: [child] })
          )
        : removeFromSlot(
            root,
            entry.parentId,
            entry.slotName,
            entry.node.id,
            declared
          );
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
