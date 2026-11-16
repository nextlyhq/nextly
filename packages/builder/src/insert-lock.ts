/**
 * Whether the locks let a block go in at a place, answered from the structure
 * around that place rather than by inserting it into a copy of the page.
 *
 * The Add panel shows every tile as available or not the moment it opens, and
 * again after every edit while it is open. Asking the editor's own lock
 * question for each tile tried an insert of every tile on a copy of the whole
 * page, which on a long page held the panel for seconds. An insert can break a
 * lock in two ways, and both are read off the place it lands:
 *
 * - **A Layers lock on the destination**: the container it goes into, or one
 *   around it, is locked. The engine's own rule (`layersLockBreak`) answers
 *   this from the page as it stands, and it is the same for every tile.
 * - **A slot's lock**: the slot it goes into fixes its blocks, declared by its
 *   block or inherited from a slot around it. Whether the slot is locked is
 *   read along the path to it (`slotLockOf`); only then is the engine's lock
 *   judgement (`lockRefusal`) asked, of that path alone, before and after the
 *   block is put in. Per block, because where a locked slot is already broken,
 *   putting back the block it is missing repairs it while any other block
 *   breaks it further.
 *
 * One more lock only shows on the composed page: a lock a component places on
 * the content a page puts inside it. A place inside a placed component is
 * therefore asked the editor's full lock question (`ask`), which composes
 * the page; every other place is answered from its structure alone.
 *
 * @module insert-lock
 */

import {
  isComponentInstance,
  layersLockBreak,
  lockRefusal,
  slotLockOf,
  type ActiveSlotLock,
  type BlockDocument,
  type BlockNode,
  type DocumentLimits,
  type NestingSource,
  type SlotDefaultSource,
} from "@nextlyhq/blocks-engine";

import { factsOfBreak, type LockRefusalFacts } from "./lock-refusal";
import type { BuilderOp, OpPosition } from "./op-vocabulary";

/** What the lock rules are read from: the editor's own lock sources. */
export interface InsertLockSources {
  readonly definitions: SlotDefaultSource;
  readonly nesting?: NestingSource;
  readonly limits: DocumentLimits;
  /** The editor's full lock question, for a place inside a placed component. */
  readonly ask: (ops: readonly BuilderOp[]) => LockRefusalFacts | undefined;
}

/** One block on the path to a place, and the slot of it the path goes into. */
interface PathStep {
  readonly node: BlockNode;
  readonly slot: string;
}

/**
 * What the locks say of any block at one place: read once per place, then
 * asked of each block with {@link InsertLock.of}.
 */
export interface InsertLock {
  /** The refusal for putting `node` in at the place, or none. */
  readonly of: (node: BlockNode) => LockRefusalFacts | undefined;
}

/** The locks at `at` in `document`, for every block an author might add there. */
export function insertLockAt(
  document: BlockDocument,
  at: OpPosition,
  sources: InsertLockSources
): InsertLock {
  let destination: { facts: LockRefusalFacts | undefined } | undefined;
  // The path is read only for a place inside a block, and once.
  const path = at.parentId === undefined ? [] : pathTo(document.nodes, at);
  const locked = path.length > 0 && slotIsLocked(path, sources.definitions);
  const composed = path.some(step => isComponentInstance(step.node));
  return {
    of: node => {
      if (composed) return sources.ask([{ kind: "insert", node, at }]);
      // The destination's lock is the same for every block, so asked once.
      destination ??= {
        facts: destinationLock(document, { kind: "insert", node, at }),
      };
      if (destination.facts !== undefined) return destination.facts;
      if (!locked) return undefined;
      return slotLockBreak(document, path, at.index, node, sources);
    },
  };
}

/** A Layers lock the insert breaks, worded as every lock refusal is. */
function destinationLock(
  document: BlockDocument,
  op: { kind: "insert"; node: BlockNode; at: OpPosition }
): LockRefusalFacts | undefined {
  const broken = layersLockBreak(document.nodes, op);
  return broken === undefined ? undefined : factsOfBreak(document, op, broken);
}

/**
 * The blocks from the top of the page down to the place's own container, each
 * with the slot the path goes into, or none when the page no longer holds it.
 */
function pathTo(nodes: readonly BlockNode[], at: OpPosition): PathStep[] {
  if (at.parentId === undefined) return [];
  const target = at.parentId;
  const into = at.slot;
  const found: PathStep[] = [];
  const visit = (list: readonly unknown[]): boolean => {
    for (const entry of list) {
      const node = entry as BlockNode | null | undefined;
      if (node === null || node === undefined) continue;
      if (node.id === target) {
        found.push({ node, slot: into });
        return true;
      }
      for (const [slot, children] of Object.entries(node.slots ?? {})) {
        if (!Array.isArray(children)) continue;
        found.push({ node, slot });
        if (visit(children)) return true;
        found.pop();
      }
    }
    return false;
  };
  return visit(nodes) ? found : [];
}

/** Whether the slot at the end of the path carries a lock, its own or inherited. */
function slotIsLocked(
  path: readonly PathStep[],
  definitions: SlotDefaultSource
): boolean {
  let lock: ActiveSlotLock | undefined;
  for (const step of path) {
    lock = slotLockOf(definitions, step.node.type, step.slot, lock);
  }
  return lock !== undefined;
}

/**
 * The lock break putting `node` in at `index` of the path's last slot adds,
 * judged by the engine on the path alone: each block above keeps only the
 * child the path goes through, and the container keeps everything it holds.
 * What the cut-away blocks would add is the same before and after, so it adds
 * no break of its own.
 */
function slotLockBreak(
  document: BlockDocument,
  path: readonly PathStep[],
  index: number,
  node: BlockNode,
  sources: InsertLockSources
): LockRefusalFacts | undefined {
  const holder = path[path.length - 1];
  if (holder === undefined) return undefined;
  const held = holder.node.slots?.[holder.slot] ?? [];
  const after = [...held];
  after.splice(index, 0, node);
  const region = (container: BlockNode): BlockDocument => {
    let top = container;
    for (let i = path.length - 2; i >= 0; i -= 1) {
      const step = path[i];
      if (step === undefined) break;
      top = { ...step.node, slots: { [step.slot]: [top] } };
    }
    return { ...document, nodes: [top] };
  };
  return lockRefusal(
    region(holder.node),
    region({
      ...holder.node,
      slots: { ...holder.node.slots, [holder.slot]: after },
    }),
    {
      definitions: sources.definitions,
      ...(sources.nesting === undefined ? {} : { nesting: sources.nesting }),
      limits: sources.limits,
    }
  );
}
