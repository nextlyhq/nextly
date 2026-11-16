/**
 * The placement repair: every block the placement rule refuses where it sits,
 * moved to the nearest place the rule allows it.
 *
 * A page stored before the rule, or written by an import, can hold a block
 * where the rule now refuses it: a Button inside a linked Card, or a block
 * filed in a slot its container never declares. A save keeps those as
 * warnings; this is the repair the editor offers for them, run by the shared
 * planner (`planRepair`) after the lock rule, so a lock's repair is settled
 * before a placement is judged.
 *
 * Lossless, as every rule is: a moved block keeps its id and everything inside
 * it, and no block is dropped. A block with nowhere it may go stays where it
 * is, and the plan's `remainingPlacements` names it.
 *
 * @module placement-repair
 */
import type { BlockDocument, BlockNode } from "./document";
import { DEFAULT_LIMITS } from "./limits";
import { lockRefusal, type LockSources } from "./lock-breaks";
import {
  canPlace,
  placementSiteIn,
  type PlacementPosition,
  type PlacementSite,
  type PlacementSources,
} from "./placement";
import {
  placementBreaksIn,
  type LocatedPlacementBreak,
} from "./placement-breaks";
import {
  placementSourcesOf,
  placesOf,
  type Place,
  type RepairRule,
  type RepairStep,
} from "./repair-plan";

/** What one move reads besides the document it changes. */
interface MoveContext {
  readonly sources: LockSources;
  readonly judged: PlacementSources;
  readonly maxNodes: number;
  /** Every block this rule has moved so far, by id. */
  readonly moved: ReadonlySet<string>;
  /** Where each block of the document sat when the round began. */
  readonly places: ReadonlyMap<string, Place>;
  /**
   * Each container position's site, read once per round: a site is its
   * parent and what the parent's ancestors refuse, and no move in a round
   * changes the ancestry of a block another move lands beside.
   */
  readonly sites: Map<string, PlacementSite | undefined>;
}

/**
 * The placement rule: each block the placement rule refuses, moved out of the
 * slot it sits in to just after the nearest ancestor whose own container
 * allows it, or to the top level just after its top-level ancestor.
 *
 * In rounds, each judged on what the last left. A block whose subtree holds
 * another break waits for a later round, since the rule judges a moved block
 * with everything inside it and would refuse the whole subtree anywhere. The
 * blocks moved in one round are never inside one another, so no move in a
 * round changes where another's ancestors sit, and one walk of the document
 * serves the whole round. A move that would add a lock break is not taken. A
 * break with no allowed place is set aside, and the rest are still repaired.
 *
 * @experimental
 */
export const placementRepairRule: RepairRule = {
  name: "nextly/placement",
  apply(document, context) {
    const current = structuredClone(document);
    const { sources } = context;
    const judged = placementSourcesOf(sources);
    if (judged === undefined) return { document: current, steps: [] };
    const limits = sources.limits ?? DEFAULT_LIMITS;
    const steps: RepairStep[] = [];
    const moved = new Set<string>();
    const unreachable = new Set<string>();
    // Each move removes the break it answers and adds none: the moved block,
    // with its subtree, is placed only where the rule allows all of it, and
    // nothing else changes ancestry. A break no move reaches is set aside.
    // Every round does one or the other, so the breaks found bound the
    // rounds, as does the node cap.
    const most =
      Math.min(
        placementBreaksIn(current, judged, limits).length,
        limits.maxNodes
      ) + 1;
    for (let round = 0; round < most; round += 1) {
      const ready = readyBreaks(
        placementBreaksIn(current, judged, limits),
        unreachable
      );
      if (ready.length === 0) break;
      const round_: MoveContext = {
        sources,
        judged,
        maxNodes: limits.maxNodes,
        moved,
        places: placesOf(current, sources, limits.maxNodes),
        sites: new Map(),
      };
      for (const found of ready) {
        const step = moveToNearest(current, found.id, round_);
        // Left for the plan's `remainingPlacements` to name.
        if (step === undefined) {
          unreachable.add(found.id);
          continue;
        }
        steps.push(step);
        moved.add(step.nodeId);
      }
    }
    return { document: current, steps };
  },
};

/** A break a move can answer: a block with an id, inside a slot. */
type MovableBreak = LocatedPlacementBreak & { readonly id: string };

/**
 * The breaks, in the walk's order, whose subtrees hold no other break still
 * to be tried: the ones a round moves. A top-level block has no ancestor to
 * move beside, and a block without an id cannot be named in a step, so
 * neither is tried.
 */
function readyBreaks(
  breaks: readonly LocatedPlacementBreak[],
  unreachable: ReadonlySet<string>
): MovableBreak[] {
  const tried = breaks.filter(
    (found): found is MovableBreak =>
      found.id !== undefined &&
      found.parentId !== undefined &&
      !unreachable.has(found.id)
  );
  // Every pointer that is a proper prefix of a break's, so a break with one
  // still to be tried beneath it is found in one lookup rather than by
  // comparing every pair. A prefix that names no node matches no break.
  const above = new Set<string>();
  for (const found of tried) {
    for (let at = found.path.lastIndexOf("/"); at > 0; ) {
      const prefix = found.path.slice(0, at);
      if (above.has(prefix)) break;
      above.add(prefix);
      at = prefix.lastIndexOf("/");
    }
  }
  return tried.filter(found => !above.has(found.path));
}

/**
 * Move the block with this id to just after the nearest ancestor whose own
 * container the placement rule allows it in, changing `document`. The step
 * taken, or undefined when no ancestor's container allows it.
 */
function moveToNearest(
  document: BlockDocument,
  id: string,
  context: MoveContext
): Extract<RepairStep, { kind: "move" }> | undefined {
  const { places } = context;
  const at = places.get(id);
  if (at?.parent === undefined || at.slot === undefined) return undefined;
  const from = { holderId: at.parent.id, slot: at.slot };
  for (
    let up = places.get(at.parent.id);
    up !== undefined;
    up = up.parent === undefined ? undefined : places.get(up.parent.id)
  ) {
    const site = siteOf(document, containerOf(up), context);
    // A position whose parent is absent has nothing to judge against; it is
    // not a place to move to.
    if (site === undefined) continue;
    if (!canPlace([at.node], site, context.judged).allowed) continue;
    const after = landingAfter(up, context.moved);
    if (!keepsLocks(document, { block: at, ancestor: up, after }, context)) {
      continue;
    }
    relocate(at, up.siblings, after);
    return {
      kind: "move",
      cause: "placement",
      nodeId: id,
      type: at.node.type,
      from,
      after: after.id,
    };
  }
  return undefined;
}

/** A position's site, read once per round and then from the round's cache. */
function siteOf(
  document: BlockDocument,
  position: PlacementPosition,
  context: MoveContext
): PlacementSite | undefined {
  const key =
    position.kind === "root"
      ? "root"
      : `${position.parentId}\u0000${position.slot}`;
  if (!context.sites.has(key)) {
    context.sites.set(
      key,
      placementSiteIn(document.nodes, position, context.judged)
    );
  }
  return context.sites.get(key);
}

/** The position of the list a place sits in: its container's slot, or the top. */
function containerOf(place: Place): PlacementPosition {
  return place.parent === undefined || place.slot === undefined
    ? { kind: "root" }
    : { kind: "slot", parentId: place.parent.id, slot: place.slot };
}

/**
 * The block a move lands just after: the ancestor, or the last of the blocks
 * this rule already put just after it, so blocks moved out of one container
 * keep their order.
 */
function landingAfter(ancestor: Place, moved: ReadonlySet<string>): BlockNode {
  const list = ancestor.siblings;
  let index = list.indexOf(ancestor.node);
  while (index + 1 < list.length && moved.has(list[index + 1].id)) index += 1;
  return list[index];
}

/** Take a block out of its list and put it just after `after` in `into`. */
function relocate(at: Place, into: BlockNode[], after: BlockNode): void {
  at.siblings.splice(at.siblings.indexOf(at.node), 1);
  into.splice(into.indexOf(after) + 1, 0, at.node);
}

/**
 * Whether the move adds no lock break. Only a locked slot the block leaves or
 * enters can gain one, so a move between unlocked slots is not tried on a
 * copy; one that touches a lock is, and judged by the lock rule's own
 * before/after comparison.
 */
function keepsLocks(
  document: BlockDocument,
  move: { block: Place; ancestor: Place; after: BlockNode },
  context: MoveContext
): boolean {
  // A place's lock is the lock of the slot it sits in: the block's is the slot
  // it leaves, the ancestor's the one it enters.
  if (move.block.lock === undefined && move.ancestor.lock === undefined) {
    return true;
  }
  const trial = structuredClone(document);
  const copies = placesOf(trial, context.sources, context.maxNodes);
  const block = copies.get(move.block.node.id);
  const into = copies.get(move.ancestor.node.id);
  const anchor = copies.get(move.after.id);
  if (block === undefined || into === undefined || anchor === undefined) {
    return false;
  }
  relocate(block, into.siblings, anchor.node);
  return lockRefusal(document, trial, context.sources) === undefined;
}
