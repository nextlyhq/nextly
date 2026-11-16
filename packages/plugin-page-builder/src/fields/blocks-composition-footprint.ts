/**
 * A component's footprint: what its composed tree offers the documents that
 * place it (roots, depth, placements, lists, conditions, exposed properties
 * and slots), and whether a change to it could make any of them worse. A
 * change that cannot needs no hosts read at all.
 *
 * Part of the blocks field's composition checks. `blocks-composition.ts` is
 * the entry, and its header explains the rules.
 *
 * @module fields/blocks-composition-footprint
 */
import {
  COLLECTION_LIST_TYPE,
  isPlainRecord,
  MAX_COMPOSED_DEPTH,
  contentModelKeyOf,
  nodeLocks,
  readListQuery,
  registryBlockSource,
  registryNestingSource,
  resolveComponentInstances,
  variantNamesIn,
  type BlockDocument,
  type BlockNode,
  type NodeLock,
  type WorkAllowance,
} from "@nextlyhq/blocks-engine";

import {
  composeWithReads,
  heldLibrary,
  hostPlacing,
  type BoundedReader,
} from "../composition-reading";

import {
  faultsIn,
  faultCounts,
  LOCK_FAULTS,
} from "./blocks-composition-faults";
import type { CompositionSetup } from "./blocks-composition-setup";

/**
 * What a host's composition can see of a component: for EACH selection a
 * placement can make, what it draws at the top, how deep it is and how deeply
 * it nests other components; and where the content a placement supplies lands.
 *
 * Per selection, because a host picks one: a change that makes the default
 * shallower and a variant deeper leaves the maximum unchanged while breaking
 * every page that picks the variant.
 */
interface Footprint {
  readonly complete: boolean;
  /** Keyed by variant id; the default selection under "". */
  readonly selections: ReadonlyMap<string, SelectionFootprint>;
  /** Each exposed slot, as the holder type, its slot and its depth. */
  readonly slots: ReadonlyMap<string, string>;
  /** Each exposed property, as the node, prop path and type it writes to. */
  readonly exposures: ReadonlyMap<string, string>;
}

interface SelectionFootprint {
  /**
   * What the placement rule reads of the composed component: each block
   * type with the content model its settings give it. A Card switching its
   * link on, or a Button added inside, changes it with the shape unmoved.
   */
  readonly placement: string;
  readonly rootTypes: ReadonlySet<string>;
  readonly depth: number;
  readonly componentDepth: number;
  /**
   * The locks the selection itself breaks, placed with no values of its own,
   * counted by fault identity: two slots of one block type broken the same
   * way read alike. A variant's value for an exposure a lock holds changes
   * what every placement picking it draws, with nothing else moved.
   */
  readonly lockFaults: ReadonlyMap<string, number>;
  /**
   * Each collection list the selection draws, by id, with its query as the
   * engine reads it. A list moved to another collection, or given other
   * filters or a sort by a variant, can make a host's own values for it
   * name fields it no longer may, with nothing a placement rule reads moved.
   */
  readonly lists: string;
  /**
   * Each block of the selection that carries visibility conditions, by id,
   * with its conditions as stored. A condition changed to check another
   * field can make a host's entry, or a list item there, one it cannot check.
   */
  readonly conditions: string;
}

/** The footprint of `document` stored as `self`, selection by selection. */
export async function footprintOf(
  self: string,
  document: BlockDocument,
  read: BoundedReader,
  setup: CompositionSetup,
  work: WorkAllowance
): Promise<Footprint> {
  // The lock each node sits under, by the rule a save enforces. Part of what
  // a placement's values and slot content are held to, so moving a node under
  // a lock, everything else kept, is a change a host can be judged against.
  const locks = nodeLocks(document.nodes, registryBlockSource());
  const library = heldLibrary(new Map([[self, document]]));
  const selections = new Map<string, SelectionFootprint>();
  let complete = true;
  for (const variant of [undefined, ...(variantNamesIn(document) ?? [])]) {
    const host = hostPlacing(self, variant);
    const composed = await composeWithReads({
      host,
      library,
      read,
      limits: setup.limits,
      work,
    });
    const componentDepth = componentDepthOf(
      self,
      variant,
      library.held,
      setup,
      work
    );
    if (composed.incomplete || componentDepth === undefined) complete = false;
    const nodes = composed.composition.document.nodes;
    selections.set(variant ?? "", {
      placement: placementFacts(nodes, setup),
      rootTypes: new Set(nodes.map(root => root.type)),
      depth: deepest(nodes, setup),
      componentDepth: componentDepth ?? MAX_COMPOSED_DEPTH + 1,
      lockFaults: faultCounts(
        faultsIn(host, composed.composition, setup).filter(fault =>
          LOCK_FAULTS.has(fault.code)
        )
      ),
      lists: listQueries(nodes, setup),
      conditions: conditionSets(nodes, setup),
    });
  }
  return {
    complete,
    selections,
    slots: exposedSlots(document, setup, locks),
    exposures: exposedProperties(document, locks),
  };
}

/**
 * Each collection list of a composed tree, by id, with its query and its
 * problems as {@link readListQuery} reads them, as one comparable string.
 */
function listQueries(
  nodes: readonly BlockNode[],
  setup: CompositionSetup
): string {
  const lists: string[] = [];
  eachComposed(nodes, setup, entry => {
    if (entry?.type !== COLLECTION_LIST_TYPE) return;
    lists.push(
      `${String(entry.id)}|${JSON.stringify(readListQuery(entry.props))}`
    );
  });
  return lists.sort().join("\n");
}

/**
 * Each block of a composed tree carrying visibility conditions, by id, with
 * its conditions as stored, as one comparable string.
 */
function conditionSets(
  nodes: readonly BlockNode[],
  setup: CompositionSetup
): string {
  const sets: string[] = [];
  eachComposed(nodes, setup, entry => {
    const visibility = (entry as { visibility?: unknown } | undefined)
      ?.visibility;
    if (!isPlainRecord(visibility) || visibility.conditions === undefined) {
      return;
    }
    sets.push(`${String(entry.id)}|${JSON.stringify(visibility.conditions)}`);
  });
  return sets.sort().join("\n");
}

/**
 * The placement facts of a composed tree, as one comparable string: every
 * node by id, under its container and slot, with its type and resolved
 * content model, bounded as `deepest` is.
 */
function placementFacts(
  nodes: readonly BlockNode[],
  setup: CompositionSetup
): string {
  const sources = {
    nesting: registryNestingSource(),
    definitions: registryBlockSource(),
  };
  const facts = new Set<string>();
  // Per node, by id and by where it sits: a set of type/model pairs alone
  // would not move when two Cards swap linked and unlinked, nor when an
  // exposed slot's holder moves under a linked Card, and either can break a
  // host filling that slot.
  eachComposed(nodes, setup, (entry, _at, under) => {
    if (typeof entry?.type !== "string") return;
    facts.add(
      `${under}>${String(entry.id)}|${entry.type}|${contentModelKeyOf(entry, sources)}`
    );
  });
  return [...facts].sort().join("\n");
}

/** The deepest node of a composed forest, counted from its own top. */
function deepest(nodes: readonly BlockNode[], setup: CompositionSetup): number {
  let most = 0;
  eachComposed(nodes, setup, (_entry, at) => {
    most = Math.max(most, at);
  });
  return most;
}

/**
 * Every node of a composed tree with its depth, to one level past the cap:
 * the one walk the footprint's measurements share.
 */
function eachComposed(
  nodes: readonly BlockNode[],
  setup: CompositionSetup,
  visitNode: (entry: BlockNode, at: number, under: string) => void
): void {
  const visit = (forest: unknown, at: number, under: string): void => {
    if (!Array.isArray(forest) || at > setup.limits.maxDepth + 1) return;
    for (const entry of forest as BlockNode[]) {
      visitNode(entry, at, under);
      const slots = (entry as { slots?: unknown }).slots;
      if (typeof slots !== "object" || slots === null) continue;
      for (const [slot, children] of Object.entries(slots)) {
        visit(children, at + 1, `${String(entry?.id)}/${slot}`);
      }
    }
  };
  visit(nodes, 1, "");
}

/**
 * How many levels of components the definition composes, by asking the
 * resolver itself: the smallest cap under which it refuses nothing for depth.
 *
 * Each probe is a composition, so each is charged to the save's allowance like
 * any other. `undefined` when the allowance ran out first: a probe stopped by
 * it refuses for the budget rather than for depth, and read as a depth answer
 * that would make the component look shallower than it is.
 */
function componentDepthOf(
  self: string,
  variant: string | undefined,
  held: ReadonlyMap<string, unknown>,
  setup: CompositionSetup,
  work: WorkAllowance
): number | undefined {
  const lookup = {
    has: (id: string) => held.has(id),
    get: (id: string) => held.get(id) as BlockDocument | undefined,
  };
  for (let cap = 1; cap <= MAX_COMPOSED_DEPTH; cap += 1) {
    const { unresolved } = resolveComponentInstances(
      hostPlacing(self, variant),
      lookup,
      {
        limits: setup.limits,
        maxComposedDepth: cap,
        work,
      }
    );
    if (work.left <= 0 || unresolved.some(one => one.reason === "budget")) {
      return undefined;
    }
    if (!unresolved.some(one => one.reason === "composed-depth")) return cap;
  }
  return MAX_COMPOSED_DEPTH + 1;
}

/**
 * Each exposed property, keyed by its id, as `nodeId|propPath|type|lock`, the
 * lock being the one its node sits under.
 */
function exposedProperties(
  document: BlockDocument,
  locks: ReadonlyMap<string, NodeLock>
): ReadonlyMap<string, string> {
  const declared = (document as { exposed?: unknown }).exposed;
  const out = new Map<string, string>();
  if (!Array.isArray(declared)) return out;
  for (const entry of declared as Record<string, unknown>[]) {
    if (typeof entry?.id !== "string") continue;
    out.set(
      entry.id,
      `${String(entry.nodeId)}|${String(entry.propPath)}|${String(entry.type)}|${lockOf(locks, entry.nodeId)}`
    );
  }
  return out;
}

/**
 * Each exposed slot, keyed by its id, as `nodeId|type|slot|depth|lock` of its
 * holder. The node is part of it: two holders of one type, slot and depth can
 * still draw what lands in them differently. So is the lock it sits under,
 * which its slot passes on to what a placement puts there.
 */
function exposedSlots(
  document: BlockDocument,
  setup: CompositionSetup,
  locks: ReadonlyMap<string, NodeLock>
): ReadonlyMap<string, string> {
  const declared = (document as { slots?: unknown }).slots;
  const out = new Map<string, string>();
  if (typeof declared !== "object" || declared === null) return out;
  const depthOf = new Map<string, { type: string; depth: number }>();
  const visit = (forest: unknown, at: number): void => {
    if (!Array.isArray(forest) || at > setup.limits.maxDepth + 1) return;
    for (const entry of forest as BlockNode[]) {
      if (typeof entry?.id === "string") {
        depthOf.set(entry.id, { type: String(entry.type), depth: at });
      }
      for (const children of Object.values(entry?.slots ?? {})) {
        visit(children, at + 1);
      }
    }
  };
  visit(document.nodes, 1);
  for (const [id, slot] of Object.entries(declared)) {
    const nodeId = String((slot as { nodeId?: unknown }).nodeId);
    const holder = depthOf.get(nodeId);
    const name = String((slot as { slot?: unknown }).slot);
    out.set(
      id,
      holder === undefined
        ? "?"
        : // The allow-list too: narrowing it can refuse content a host
          // already put in the slot, with nothing else about the slot moved.
          `${nodeId}|${holder.type}|${name}|${holder.depth}|${lockOf(locks, nodeId)}|${JSON.stringify((slot as { allow?: unknown }).allow ?? null)}`
    );
  }
  return out;
}

/** The lock a node sits under, as a footprint records it. */
function lockOf(locks: ReadonlyMap<string, NodeLock>, nodeId: unknown): string {
  return (
    (typeof nodeId === "string" ? locks.get(nodeId)?.lock : undefined) ?? "-"
  );
}

/**
 * Whether a host could be judged differently after the change.
 *
 * Conservative in one direction only: a footprint that could not be worked out
 * may worsen, and so does, in any one selection, a new root type, extra depth
 * or extra component depth, as does a selection that did not exist before, any
 * slot that moved, and any exposure added, re-aimed or removed. A slot removed
 * or a root type dropped cannot make a host break a rule it kept before; an
 * exposure removed can, since the host's override of it falls back to the
 * default, which may draw what the override kept out.
 */
export function mayWorsen(was: Footprint, now: Footprint): boolean {
  if (!was.complete || !now.complete) return true;
  return (
    selectionsWorsen(was, now) ||
    removedSelectionsWorsen(was, now) ||
    // What a placement can override: a new or re-aimed exposure lets a host's
    // existing override reach somewhere it could not, a loop included. Read
    // the other way, an exposure that is gone hands the default back.
    moved(was.exposures, now.exposures) ||
    moved(now.exposures, was.exposures) ||
    moved(was.slots, now.slots)
  );
}

/** Whether any selection that exists now is worse than it was, or new. */
function selectionsWorsen(was: Footprint, now: Footprint): boolean {
  for (const [name, after] of now.selections) {
    const before = was.selections.get(name);
    if (before === undefined || selectionWorsens(before, after)) return true;
  }
  return false;
}

/**
 * Whether a selection that went away hands its placements something worse: a
 * placement that picked it now gets the default.
 */
function removedSelectionsWorsen(was: Footprint, now: Footprint): boolean {
  const fallback = now.selections.get("");
  for (const [name, before] of was.selections) {
    if (now.selections.has(name)) continue;
    if (fallback === undefined || selectionWorsens(before, fallback))
      return true;
  }
  return false;
}

/** Whether any entry present now is new or different. Removals do not count. */
function moved(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>
): boolean {
  for (const [key, value] of after) if (before.get(key) !== value) return true;
  return false;
}

function selectionWorsens(
  before: SelectionFootprint,
  after: SelectionFootprint
): boolean {
  // Any change to what the placement rule reads may break a host, in either
  // direction a host cannot be told apart from here, so it is judged.
  if (after.placement !== before.placement) return true;
  // Any list that changed may now refuse what a host gives it.
  if (after.lists !== before.lists) return true;
  // Any condition that changed may now check a field a host's entry can't give.
  if (after.conditions !== before.conditions) return true;
  if (after.depth > before.depth) return true;
  if (after.componentDepth > before.componentDepth) return true;
  for (const type of after.rootTypes) {
    if (!before.rootTypes.has(type)) return true;
  }
  for (const [fault, count] of after.lockFaults) {
    if (count > (before.lockFaults.get(fault) ?? 0)) return true;
  }
  return false;
}
