/**
 * The Layers lock, judged for one edit.
 *
 * An author locks a block in Layers to keep it, and everything inside it, as it
 * is. It is a convenience that anyone who may edit the document can lift, and
 * never a permission: who may edit a document stays the collection's access
 * rules' question. What it guards against is the accidental change, so it holds
 * on every path that edits a document: here for the op layer, which every
 * editing surface, plugin route and agent applies its edits through, and in
 * `layers-lock-stored` for a write judged against the stored document.
 *
 * ## What an edit may not do
 *
 * Nothing inside a locked block changes, moves or goes away while it is locked:
 *
 * - an update may not touch the locked block or anything inside it;
 * - a remove or a move may not take a locked block with it, nor take a block
 *   out of a locked one;
 * - an insert or a move may not put a block into a locked one.
 *
 * Changing a block's `locked` flag alone is always allowed, inside a locked
 * block too. Unlocking is how the lock is lifted, and locking has to stay
 * possible wherever unlocking is, or the undo of an unlock would be refused and
 * a mixed selection could not be locked at all.
 *
 * Blocks AROUND a locked one are free to change: a container holding a locked
 * caption may be restyled, because its own props are not inside the caption.
 *
 * @module layers-lock
 */
import type { BlockNode } from "./document";
import type { BuilderOp } from "./ops";
import { isPlainRecord } from "./plain-record";
import { walkNodes } from "./tree";

/**
 * The first locked node anywhere in a subtree, or `undefined`.
 *
 * Exported because a PLANNER has to be able to ask it before an insert is
 * built. `applyOp` refuses an insert whose subtree arrives locked — the inverse
 * of an insert is a remove, and a remove refuses a locked subtree, so accepting
 * it would put the document one edit from a state its own undo could not leave.
 * A planner that could not ask would report a plan the apply then throws on,
 * which is exactly the gap between a dry run and a real run that planning
 * separately exists to close.
 *
 * The whole subtree and not just its root, because removing a container removes
 * everything under it. A check that read only the node an op addresses would
 * let an author delete a locked block by deleting the column it sits in — the
 * lock honoured at the node and defeated one level up.
 */
export function lockedWithin(node: BlockNode): string | undefined {
  let found: string | undefined;
  walkNodes([node], candidate => {
    if (found === undefined && candidate.locked === true) found = candidate.id;
  });
  return found;
}

/** Every node by id, and the node each one sits inside, from one walk. */
interface Family {
  readonly byId: ReadonlyMap<string, BlockNode>;
  readonly parentOf: ReadonlyMap<string, BlockNode | undefined>;
}

/**
 * The forest's nodes and parents, read once.
 *
 * The FIRST node holding an id wins. `applyOp` refuses an op addressing an id
 * the document holds twice before it asks this, so for every id an op names
 * there is only one answer to give.
 */
function familyOf(nodes: BlockNode[]): Family {
  const byId = new Map<string, BlockNode>();
  const parentOf = new Map<string, BlockNode | undefined>();
  walkNodes(nodes, (node, parent) => {
    if (byId.has(node.id)) return;
    byId.set(node.id, node);
    parentOf.set(node.id, parent);
  });
  return { byId, parentOf };
}

/**
 * The nearest locked node from `from` outwards, `from` included.
 *
 * The visited set stops the climb on a parent chain that loops back on itself,
 * which a damaged forest with a repeated id can describe even though the walk
 * that built it cannot.
 */
function nearestLocked(
  family: Family,
  from: BlockNode | undefined
): BlockNode | undefined {
  const seen = new Set<string>();
  let current = from;
  while (current !== undefined && !seen.has(current.id)) {
    if (current.locked === true) return current;
    seen.add(current.id);
    current = family.parentOf.get(current.id);
  }
  return undefined;
}

/**
 * The nearest locked block the node `id` sits inside, the node itself
 * excluded, or `undefined`.
 *
 * What makes a block inside a locked one locked too: the lock covers the
 * subtree, so a child carries its ancestor's lock without a flag of its own.
 */
export function lockedAncestorOf(
  nodes: BlockNode[],
  id: string
): BlockNode | undefined {
  const family = familyOf(nodes);
  return nearestLocked(family, family.parentOf.get(id));
}

/** A Layers lock an op would break, and where the locked block sits. */
export interface LayersLockBreak {
  /** The locked block the op would change, move or remove. */
  readonly lockedId: string;
  /**
   * Where the locked block sits relative to the op:
   * - `within`: it is the block the op addresses, or inside it;
   * - `around`: the block the op addresses sits inside it;
   * - `destination`: the op would put a block into it, or into a block inside
   *   it.
   */
  readonly where: "within" | "around" | "destination";
}

/**
 * Whether an update changes nothing but the `locked` flag.
 *
 * Read from the op's own fields, so a patch carrying any other key, set or
 * removed, is a change to the block and not a lock change.
 */
function changesOnlyTheLock(
  op: Extract<BuilderOp, { kind: "update" }>
): boolean {
  const patched = isPlainRecord(op.patch) ? Object.keys(op.patch) : [];
  const removed = Array.isArray(op.unset) ? op.unset : [];
  return [...patched, ...removed].every(key => key === "locked");
}

/** The lock around `id`, the node itself excluded, as a break. */
function aroundBreak(family: Family, id: string): LayersLockBreak | undefined {
  const holder = nearestLocked(family, family.parentOf.get(id));
  return holder === undefined
    ? undefined
    : { lockedId: holder.id, where: "around" };
}

/** The lock on a destination parent or around it, as a break. */
function destinationBreak(
  family: Family,
  parentId: string | undefined
): LayersLockBreak | undefined {
  if (parentId === undefined) return undefined;
  const holder = nearestLocked(family, family.byId.get(parentId));
  return holder === undefined
    ? undefined
    : { lockedId: holder.id, where: "destination" };
}

/** The lock inside the subtree rooted at `node`, itself included, as a break. */
function withinBreak(node: BlockNode): LayersLockBreak | undefined {
  const lockedId = lockedWithin(node);
  return lockedId === undefined ? undefined : { lockedId, where: "within" };
}

/**
 * The Layers lock `op` would break in `nodes`, or `undefined` when it keeps
 * every lock.
 *
 * Pure, and the one statement of the rule: `applyOp` asks it of every op, and
 * an editing surface asks the same function before it offers an action, so a
 * control can never offer what the apply then refuses.
 *
 * Ops naming an id the forest does not hold are not this function's to refuse:
 * it answers `undefined`, and the apply refuses them for that reason instead.
 *
 * @param nodes - the forest the op would be applied to
 * @param op - the edit
 * @returns the locked block the op would change, move or remove, and where it
 *   sits, or `undefined`
 */
export function layersLockBreak(
  nodes: BlockNode[],
  op: BuilderOp
): LayersLockBreak | undefined {
  // Answered before the walk: the commonest lock edit costs nothing more.
  if (op.kind === "update" && changesOnlyTheLock(op)) return undefined;
  const family = familyOf(nodes);
  switch (op.kind) {
    case "insert":
      return destinationBreak(family, op.at.parentId);
    case "update": {
      // The block's own props, styles and name, so the block itself and the
      // blocks around it. Blocks INSIDE it are not changed by its update.
      const node = family.byId.get(op.id);
      if (node === undefined) return undefined;
      return node.locked === true
        ? { lockedId: node.id, where: "within" }
        : aroundBreak(family, op.id);
    }
    case "remove": {
      const node = family.byId.get(op.id);
      if (node === undefined) return undefined;
      return withinBreak(node) ?? aroundBreak(family, op.id);
    }
    case "move": {
      const node = family.byId.get(op.id);
      if (node === undefined) return undefined;
      return (
        withinBreak(node) ??
        aroundBreak(family, op.id) ??
        destinationBreak(family, op.to.parentId)
      );
    }
    default:
      return undefined;
  }
}
