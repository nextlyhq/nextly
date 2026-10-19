/**
 * What a document that breaks a rule becomes, and the steps that get it
 * there, for an author to see and confirm before anything changes.
 *
 * One planner, run as a list of rules, each on what the one before left: the
 * lock rule here first, and any later rule (a placement rule, say) appended
 * rather than built beside it. A rule never discards an authored block, and
 * every block it keeps keeps its id.
 *
 * @module repair-plan
 */
import { nodeLocks } from "./content-only-exposures";
import type { BlockDocument, BlockNode } from "./document";
import {
  countNodes as countForest,
  DEFAULT_LIMITS,
  ForestTooLargeError,
  treeDepth,
  type DocumentLimits,
} from "./limits";
import {
  lockBreaksIn,
  type LocatedLockBreak,
  type LockSources,
} from "./lock-breaks";
import { placementVerdict, type PlacementTarget } from "./nesting";
import { isPlainRecord } from "./plain-record";
import { contentPropsOf, designChanges, withStartingDesign } from "./slot-lock";
import { startingChildrenSource } from "./starting-children";
import { newId } from "./tree";
import { walkNodeForest } from "./validation";

/** A locked slot, by the block holding it. */
export interface SlotPlace {
  readonly holderId: string;
  readonly slot: string;
}

/** One change a repair makes, as a preview names it. */
export type RepairStep =
  | {
      /** A block the slot may not hold, moved where no lock fixes the blocks. */
      readonly kind: "move";
      readonly nodeId: string;
      readonly type: string;
      readonly from: SlotPlace;
      /**
       * Placed just after this block, in the slot it sits in or at the top:
       * the outermost locked block for the first block a slot moves out, and
       * the block moved before it for each after, so the steps in order give
       * the result's order.
       */
      readonly after: string;
    }
  | {
      /** A starting block the slot is missing, added under a new id. */
      readonly kind: "add";
      readonly nodeId: string;
      readonly type: string;
      readonly at: SlotPlace & { readonly index: number };
    }
  | {
      /** The slot's blocks put back in their starting order. */
      readonly kind: "reorder";
      readonly holderId: string;
      readonly slot: string;
      readonly order: readonly string[];
    }
  | {
      /** A block's design put back as it started, its content kept. */
      readonly kind: "reset";
      readonly nodeId: string;
      readonly type: string;
      readonly parts: readonly string[];
    };

/** What a rule reads besides the document. */
export interface RepairContext {
  readonly sources: LockSources;
}

/** One rule of the planner: the document it leaves, and how it got there. */
export interface RepairRule {
  readonly name: string;
  apply(
    document: BlockDocument,
    context: RepairContext
  ): {
    readonly document: BlockDocument;
    readonly steps: readonly RepairStep[];
  };
}

/** A repair: the steps to show, and the document confirming them stores. */
export interface RepairPlan {
  readonly steps: readonly RepairStep[];
  readonly result: BlockDocument;
  /**
   * The lock breaks the result still holds, which no rule could repair: a
   * block with nowhere its nesting rule lets it go, say. Empty when the result
   * keeps every lock; a preview says what is left when it is not.
   */
  readonly remaining: readonly LocatedLockBreak[];
}

/**
 * Plan the repair of `document`, rule by rule. The document is not changed;
 * the plan's `result` is a new one.
 *
 * A document past its node or depth limits is not one a save would store, so
 * nothing is planned for it: no steps, the document itself as the result, and
 * its breaks named in `remaining`. The rules copy and index the document they
 * are given, and past the limits that work is not bounded.
 *
 * @experimental
 */
export function planRepair(
  document: BlockDocument,
  sources: LockSources,
  rules: readonly RepairRule[] = [lockRepairRule]
): RepairPlan {
  const limits = sources.limits ?? DEFAULT_LIMITS;
  if (!withinLimits(document, limits)) {
    return {
      steps: [],
      result: document,
      remaining: lockBreaksIn(document, sources),
    };
  }
  let result = structuredClone(document);
  const steps: RepairStep[] = [];
  for (const rule of rules) {
    const applied = rule.apply(result, { sources });
    result = applied.document;
    steps.push(...applied.steps);
  }
  // Starting blocks a repair adds can take a document past its limits, and a
  // result a save would refuse is no repair: nothing is planned then, and the
  // breaks are named as before.
  if (!withinLimits(result, limits)) {
    return {
      steps: [],
      result: document,
      remaining: lockBreaksIn(document, sources),
    };
  }
  return { steps, result, remaining: lockBreaksIn(result, sources) };
}

/**
 * The lock rule: every slot holds the blocks it starts with, in their order
 * where the lock fixes it, and every block inside `"contentOnly"` has its
 * starting design.
 *
 * One break at a time, each judged again on what the last repair left, so a
 * repair of an outer slot is seen before an inner one is judged. A break no
 * repair can reach is set aside, and the rest are still repaired.
 *
 * @experimental
 */
export const lockRepairRule: RepairRule = {
  name: "nextly/locks",
  apply(document, context) {
    const current = structuredClone(document);
    const steps: RepairStep[] = [];
    const { sources } = context;
    const maxNodes = (sources.limits ?? DEFAULT_LIMITS).maxNodes;
    // Each repair removes the break it answers and adds none, and a break no
    // repair reaches is set aside, so the breaks found, plus a round per node
    // for any an outer repair uncovers, bound the work however many locked
    // slots one block declares.
    const most =
      lockBreaksIn(current, sources).length + countNodes(current, maxNodes) + 1;
    const unreachable = new Set<string>();
    // Expanded once for the whole plan, so each added block is a copy of
    // what an insert creates, given ids of its own.
    const starting = startingChildrenSource(
      sources.definitions,
      sources.nesting
    );
    for (let round = 0; round < most; round += 1) {
      const found = lockBreaksIn(current, sources).find(
        each => !unreachable.has(placeOfBreak(each))
      );
      if (found === undefined) break;
      const repaired = repairOne(current, found, {
        sources,
        starting,
        maxNodes,
      });
      // Left for the plan's `remaining` to name.
      if (repaired.length === 0) unreachable.add(placeOfBreak(found));
      steps.push(...repaired);
    }
    return { document: current, steps };
  },
};

/** Whether a document's forest is within its node and depth limits. */
function withinLimits(
  document: BlockDocument,
  limits: DocumentLimits
): boolean {
  try {
    return (
      countForest(document.nodes) <= limits.maxNodes &&
      treeDepth(document.nodes) <= limits.maxDepth
    );
  } catch (error) {
    // Too large for the bounded walk to measure is past the limits too.
    if (error instanceof ForestTooLargeError) return false;
    throw error;
  }
}

/** A break by its rule and place, to set aside one no repair reaches. */
function placeOfBreak(found: LocatedLockBreak): string {
  return [found.code, found.holderId, found.slot, found.index ?? ""].join(
    "\u0000"
  );
}

/** Repair one break in place, returning its steps; none when it cannot be reached. */
function repairOne(
  document: BlockDocument,
  found: LocatedLockBreak,
  context: {
    sources: LockSources;
    starting: (type: string, slot: string) => readonly BlockNode[];
    maxNodes: number;
  }
): RepairStep[] {
  const { sources } = context;
  const places = placesOf(document, context.maxNodes);
  const holder = places.get(found.holderId)?.node;
  if (holder === undefined) return [];
  const starting = context.starting(holder.type, found.slot);
  if (found.code === "locked-slot-content-only") {
    return resetDesign(holder, found, starting, sources);
  }
  return refillSlot(document, places, holder, found, starting, sources);
}

/**
 * Put back the parts of one child's design the break names. A part the
 * stored copy already holds is the page's to keep, so the step names exactly
 * what changes.
 */
function resetDesign(
  holder: BlockNode,
  found: LocatedLockBreak,
  starting: readonly BlockNode[],
  sources: LockSources
): RepairStep[] {
  const children = holder.slots?.[found.slot];
  const index = found.index ?? -1;
  const child = children?.[index];
  const start = starting[index];
  if (children === undefined || child === undefined || start === undefined) {
    return [];
  }
  const content = contentPropsOf(sources.definitions.get(start.type)?.props);
  const held = child as unknown as Record<string, unknown>;
  const startingChild = start as unknown as Record<string, unknown>;
  const parts = designChanges(held, startingChild, content)
    .filter(change => found.changes.includes(change.words))
    .map(change => change.part);
  children[index] = withStartingDesign(
    held,
    startingChild,
    content,
    parts
  ) as unknown as BlockNode;
  return [
    { kind: "reset", nodeId: child.id, type: child.type, parts: found.changes },
  ];
}

/**
 * Give a locked slot exactly its starting blocks: the authored ones that
 * match stay, the rest move out, and the missing ones are added.
 */
function refillSlot(
  document: BlockDocument,
  places: ReadonlyMap<string, Place>,
  holder: BlockNode,
  found: LocatedLockBreak,
  starting: readonly BlockNode[],
  sources: LockSources
): RepairStep[] {
  const held = [...(holder.slots?.[found.slot] ?? [])];
  const matched = matchStarting(held, starting);
  const kept = new Set(matched.filter(index => index !== undefined));
  const extras = held.filter((_, index) => !kept.has(index));
  // Where the blocks the slot may not hold go, asked before anything changes:
  // a block the nesting rules refuse there has nowhere the lock rule can put
  // it, so this break is left to the plan's `remaining`.
  const outermost = outermostLocked(document, places, holder, sources);
  if (!placeable(extras, outermost, sources)) return [];
  const place = { holderId: found.holderId, slot: found.slot };
  const steps: RepairStep[] = [];
  const moves: RepairStep[] = [];

  const filled = starting.map((start, k) => {
    const index = matched[k];
    if (index !== undefined) return held[index];
    const added = withFreshIds(start);
    steps.push({
      kind: "add",
      nodeId: added.id,
      type: added.type,
      at: { ...place, index: k },
    });
    return added;
  });
  // Under "insert" the order is the author's; under the other locks it is fixed.
  const slot =
    found.lock === "insert" ? keepHeldOrder(held, filled, kept) : filled;
  if (
    found.lock !== "insert" &&
    !sameOrder(
      held.filter((_, index) => kept.has(index)),
      filled.filter(node => held.includes(node))
    )
  ) {
    steps.push({
      kind: "reorder",
      ...place,
      order: slot.map(node => node.id),
    });
  }
  holder.slots = { ...holder.slots, [found.slot]: slot };

  const into = outermost.siblings;
  into.splice(into.indexOf(outermost.node) + 1, 0, ...extras);
  // Each after the one before it, so the steps in order give this order.
  let after = outermost.node.id;
  for (const extra of extras) {
    moves.push({
      kind: "move",
      nodeId: extra.id,
      type: extra.type,
      from: place,
      after,
    });
    after = extra.id;
  }
  // The moves first: once the blocks the slot may not hold are out, each add's
  // index and the reorder's order name only what the slot then holds, so the
  // steps applied in order give the result.
  return [...moves, ...steps];
}

/** Whether every block may sit beside `at`, by the site's nesting rules. */
function placeable(
  blocks: readonly BlockNode[],
  at: Place,
  sources: LockSources
): boolean {
  if (blocks.length === 0 || sources.nesting === undefined) return true;
  const where: PlacementTarget =
    at.parent === undefined || at.slot === undefined
      ? { kind: "root" }
      : { kind: "slot", parentType: at.parent.type, slot: at.slot };
  return placementVerdict(
    blocks.map(block => block.type),
    where,
    sources.nesting
  ).allowed;
}

/**
 * For each starting block, the index of the authored child that stands for
 * it: the first one of its type not already taken.
 */
function matchStarting(
  held: readonly BlockNode[],
  starting: readonly BlockNode[]
): (number | undefined)[] {
  const taken = new Set<number>();
  return starting.map(start => {
    const index = held.findIndex(
      (child, at) =>
        !taken.has(at) && isPlainRecord(child) && child.type === start.type
    );
    if (index === -1) return undefined;
    taken.add(index);
    return index;
  });
}

/** The kept children in the author's order, the added ones at their starting places. */
function keepHeldOrder(
  held: readonly BlockNode[],
  filled: readonly BlockNode[],
  kept: ReadonlySet<number>
): BlockNode[] {
  const ordered = held.filter((_, index) => kept.has(index));
  filled.forEach((node, k) => {
    if (!held.includes(node))
      ordered.splice(Math.min(k, ordered.length), 0, node);
  });
  return ordered;
}

function sameOrder(a: readonly BlockNode[], b: readonly BlockNode[]): boolean {
  return a.length === b.length && a.every((node, index) => node === b[index]);
}

/** Where a node sits: the list holding it, and the block and slot it is in. */
interface Place {
  readonly node: BlockNode;
  readonly siblings: BlockNode[];
  readonly parent: BlockNode | undefined;
  readonly slot: string | undefined;
}

/**
 * Every node of the document by id, with where it sits, read off
 * validation's own walk (`walkNodeForest`), so the repair finds every block
 * `lockBreaksIn` reports, under the same bounds.
 */
function placesOf(
  document: BlockDocument,
  maxNodes: number
): Map<string, Place> {
  const places = new Map<string, Place>();
  walkNodeForest(
    document.nodes,
    maxNodes,
    { definitions: undefined, stored: undefined },
    at => {
      const node: unknown = at.node;
      if (isPlainRecord(node) && typeof node.id === "string") {
        places.set(node.id, {
          node: at.node,
          siblings: at.siblings as BlockNode[],
          parent: at.parent,
          slot: at.slot,
        });
      }
      return false;
    }
  );
  return places;
}

/**
 * The outermost block whose lock applies to `holder`'s slot: `holder` itself,
 * or the nearest ancestor that sits in no locked slot. A block placed just
 * after it changes no lock's fixed blocks.
 */
function outermostLocked(
  document: BlockDocument,
  places: ReadonlyMap<string, Place>,
  holder: BlockNode,
  sources: LockSources
): Place {
  const locks = nodeLocks(document.nodes, sources.definitions);
  let at = places.get(holder.id)!;
  while (locks.get(at.node.id)?.lock !== undefined && at.parent !== undefined) {
    // An ancestor past the index's cap is not reached; stop where it ends.
    const up = places.get(at.parent.id);
    if (up === undefined) break;
    at = up;
  }
  return at;
}

/** A starting block and everything inside it, under new ids. */
function withFreshIds(node: BlockNode): BlockNode {
  const copy = structuredClone(node);
  const renew = (each: BlockNode) => {
    each.id = newId();
    for (const children of Object.values(each.slots ?? {})) {
      for (const child of children) renew(child);
    }
  };
  renew(copy);
  return copy;
}

function countNodes(document: BlockDocument, maxNodes: number): number {
  return placesOf(document, maxNodes).size;
}
