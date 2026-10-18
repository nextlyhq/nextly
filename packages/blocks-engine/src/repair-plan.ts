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
  lockBreaksIn,
  type LocatedLockBreak,
  type LockSources,
} from "./lock-breaks";
import { isPlainRecord } from "./plain-record";
import { contentPropsOf, withStartingDesign } from "./slot-lock";
import { startingChildrenSource } from "./starting-children";
import { newId } from "./tree";

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
      /** Placed just after this block, in the slot it sits in or at the top. */
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
}

/**
 * Plan the repair of `document`, rule by rule. The document is not changed;
 * the plan's `result` is a new one.
 *
 * @experimental
 */
export function planRepair(
  document: BlockDocument,
  sources: LockSources,
  rules: readonly RepairRule[] = [lockRepairRule]
): RepairPlan {
  let result = structuredClone(document);
  const steps: RepairStep[] = [];
  for (const rule of rules) {
    const applied = rule.apply(result, { sources });
    result = applied.document;
    steps.push(...applied.steps);
  }
  return { steps, result };
}

/**
 * The lock rule: every slot holds the blocks it starts with, in their order
 * where the lock fixes it, and every block inside `"contentOnly"` has its
 * starting design.
 *
 * One break at a time, each judged again on what the last repair left, so a
 * repair of an outer slot is seen before an inner one is judged.
 *
 * @experimental
 */
export const lockRepairRule: RepairRule = {
  name: "nextly/locks",
  apply(document, context) {
    const current = structuredClone(document);
    const steps: RepairStep[] = [];
    // Each repair removes the break it answers and adds none, so a document
    // needs at most one per node; the bound stops a break no repair can reach.
    const most = countNodes(current) * 3 + 1;
    // Expanded once for the whole plan, so each added block is a copy of
    // what an insert creates, given ids of its own.
    const starting = startingChildrenSource(
      context.sources.definitions,
      context.sources.nesting
    );
    for (let round = 0; round < most; round += 1) {
      const found = lockBreaksIn(current, context.sources)[0];
      if (found === undefined) break;
      const repaired = repairOne(current, found, {
        sources: context.sources,
        starting,
      });
      if (repaired.length === 0) break;
      steps.push(...repaired);
    }
    return { document: current, steps };
  },
};

/** Repair one break in place, returning its steps; none when it cannot be reached. */
function repairOne(
  document: BlockDocument,
  found: LocatedLockBreak,
  context: {
    sources: LockSources;
    starting: (type: string, slot: string) => readonly BlockNode[];
  }
): RepairStep[] {
  const { sources } = context;
  const places = placesOf(document);
  const holder = places.get(found.holderId)?.node;
  if (holder === undefined) return [];
  const starting = context.starting(holder.type, found.slot);
  if (found.code === "locked-slot-content-only") {
    return resetDesign(holder, found, starting, sources);
  }
  return refillSlot(document, places, holder, found, starting, sources);
}

/** Put one child's design back as it started. */
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
  children[index] = withStartingDesign(
    child as unknown as Record<string, unknown>,
    start as unknown as Record<string, unknown>,
    content
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
  const place = { holderId: found.holderId, slot: found.slot };
  const steps: RepairStep[] = [];

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

  const outermost = outermostLocked(document, places, holder, sources);
  const into = outermost.siblings;
  into.splice(into.indexOf(outermost.node) + 1, 0, ...extras);
  for (const extra of extras) {
    steps.push({
      kind: "move",
      nodeId: extra.id,
      type: extra.type,
      from: place,
      after: outermost.node.id,
    });
  }
  return steps;
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

/** Where a node sits: the list holding it, and the block whose slot that is. */
interface Place {
  readonly node: BlockNode;
  readonly siblings: BlockNode[];
  readonly parent: BlockNode | undefined;
}

/** Every node of the document by id, with where it sits. */
function placesOf(document: BlockDocument): Map<string, Place> {
  const places = new Map<string, Place>();
  const visit = (siblings: BlockNode[], parent: BlockNode | undefined) => {
    for (const node of siblings) {
      if (!isPlainRecord(node) || typeof node.id !== "string") continue;
      places.set(node.id, { node, siblings, parent });
      for (const children of Object.values(node.slots ?? {})) {
        if (Array.isArray(children)) visit(children, node);
      }
    }
  };
  visit(document.nodes, undefined);
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
    at = places.get(at.parent.id)!;
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

function countNodes(document: BlockDocument): number {
  return placesOf(document).size;
}
