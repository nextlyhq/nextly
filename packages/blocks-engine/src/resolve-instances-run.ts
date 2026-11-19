/**
 * The state one resolution carries, and the survey of the host document it
 * starts from.
 *
 * @module resolve-instances-run
 */
import { COMPONENT_INSTANCE_TYPE, type ComponentDocument } from "./document";
import { walkForest } from "./forest-walk";
import { MAX_ENVELOPE_ENTRIES } from "./limits";
import { isPlainRecord } from "./plain-record";
import type {
  ComponentLookup,
  ComponentUnresolvedReason,
  UnresolvedInstance,
  WorkAllowance,
} from "./resolve-instances-contract";
import { boundedOwnKeys, ownEntry } from "./safe-record";

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Everything one resolution accumulates. */
export interface ResolveRun {
  definitions: ComponentLookup;
  maxDepth: number;
  /**
   * The document cap, kept beside the remaining budget rather than derived
   * from it. `budget` is what is LEFT, so a pass that needs to bound its own
   * work by the cap — the slot prepass does — cannot recover the cap from it.
   */
  maxNodes: number;
  maxComposedDepth: number;
  /** Whether composed nodes record the exposures that feed them. */
  exposures: boolean;
  /** Whether an instance carrying conditions is expanded, carrying them. */
  carryConditions: boolean;
  /** Nodes this resolution may still produce, across every instance. */
  budget: number;
  /**
   * The caller's work allowance, when it supplied one.
   *
   * Beside `budget` rather than inside the savepoint: a rollback gives the node
   * budget back because the composed document does not hold what was abandoned,
   * while the work of attempting it was done either way.
   */
  work: WorkAllowance | undefined;
  /** Every id in use, so a minted one cannot shadow a stored node. */
  taken: Set<string>;
  /** The same, for the ids that reach the DOM rather than the document. */
  takenDomIds: Set<string>;
  /**
   * Every DOM id this run MINTED, mapped back to the one it was derived from.
   *
   * Minted → original, not the other way round, and the direction is forced:
   * one definition id becomes a different scoped id in every instance of that
   * component, so keying on the original would keep only the last. A minted id
   * is unique to its instance, so this direction stays injective however many
   * instances a page holds.
   *
   * Published because the resolver is the only thing that knows it. A surface
   * that turns composed content back into stored content — detaching an
   * instance does exactly that — otherwise has to persist a render-time digest
   * as though an author had typed it, or invert the mint by taking the string
   * apart. This is the same gap `origin.renamed` closed for pattern inserts.
   */
  renamedDomIds: Map<string, string>;
  /**
   * The ids this run minted, in order, so a refused instance can give them
   * back. Host ids are not in it: they were never this run's to release.
   */
  minted: string[];
  /**
   * The DOM ids this run claimed, in order, so a refused expansion can give
   * them back.
   *
   * Its own list for the reason `minted` is one: `takenDomIds` is SEEDED with
   * the host document's own ids, and those were never this run's to release.
   * Without it an abandoned expansion left its claims standing, so the retry —
   * or simply the next instance — found them occupied and suffixed an id that
   * nothing else holds. An anchor, a `<label for>` or an id selector then
   * addresses a name the page does not use.
   */
  mintedDomIds: string[];
  /**
   * Why the clone in progress gave up, set on the path that returns `null`.
   *
   * A field rather than a richer return type because the two failures — the
   * node budget and the definition's own depth — are raised several frames
   * below the one that has an instance to mark, and threading a reason back
   * through every slot and forest frame would put a second meaning on every
   * one of those returns.
   */
  abort: ComponentUnresolvedReason | undefined;
  referenced: string[];
  referencedSeen: Set<string>;
  unresolved: UnresolvedInstance[];
  /**
   * Every component a loop closed on.
   *
   * Not trimmed by `rollback`, which trims `unresolved` to what the returned
   * tree holds: a loop found inside an expansion a limit stopped is still a
   * loop in the definitions. Only an expansion that could not be READ gives its
   * loops back, since the renderer draws it as a placeholder with no loop in it.
   */
  loopsClosed: string[];
  /**
   * What the lookup answered for each component this run has asked about.
   *
   * A resolution has to say ONE thing about one component. Asking per instance
   * lets a lookup that is not pure contradict itself inside a page — the first
   * instance draws the component and the second reports it unreadable — and
   * the contract deliberately admits such a lookup, because the source that
   * fetches is one.
   *
   * Only the id-dependent half is held. `cycle` and `composed-depth` are
   * properties of WHERE the instance sits, so they are decided per call and
   * never reach this.
   */
  definitionsRead: Map<string, ComponentDocument | ComponentUnresolvedReason>;
}

/** Where in the composition a forest sits: how deep, and through which components. */
export interface ComposedScope {
  depth: number;
  onPath: ReadonlySet<string>;
}

export const ROOT_SCOPE: ComposedScope = {
  depth: 0,
  onPath: new Set<string>(),
};

/** What the host document holds, read once before anything is rebuilt. */
interface HostSurvey {
  hasInstance: boolean;
  /**
   * Some node arrived already claiming `instanceOf`.
   *
   * Stored data wearing this pass's provenance. It has to be walked and cleared
   * even when the document composes nothing, so this is read beside
   * `hasInstance` rather than folded into it — the two are different reasons to
   * walk, and only one of them is about components being present.
   */
  hasStoredProvenance: boolean;
  /** The walk stopped at the node cap, so `ids` is a PREFIX of what is there. */
  truncated: boolean;
  /** How many nodes the host already holds, instances included. */
  count: number;
  ids: Set<string>;
  /**
   * Every DOM id the host page already publishes.
   *
   * Seeded for the same reason node ids are. `mintDomId` promises uniqueness
   * within the SUBTREE it copies, and the host is not in that subtree — so a
   * page whose own `cssId` happens to equal a minted one gets back exactly the
   * duplicate this remapping exists to remove.
   */
  domIds: Set<string>;
}

/**
 * Whether there is anything to do, and which ids are already spoken for.
 *
 * Both answers come from one walk because both are needed before the first node
 * is minted: the second decides what a minted id may be, and asking for it
 * lazily would mean minting against a partial set.
 */
export function surveyHost(
  nodes: readonly unknown[],
  maxNodes: number
): HostSurvey {
  const ids = new Set<string>();
  const domIds = new Set<string>();
  let hasInstance = false;
  let hasStoredProvenance = false;
  let truncated = false;
  let count = 0;
  let budget = maxNodes;
  walkForest(nodes, entry => {
    if (budget <= 0) {
      truncated = true;
      return "stop";
    }
    budget -= 1;
    count += 1;
    const node = entry.node;
    if (!isPlainRecord(node)) return "descend";
    if (typeof node.id === "string") ids.add(node.id);
    collectDomIds(node, domIds);
    if (node.type === COMPONENT_INSTANCE_TYPE) hasInstance = true;
    // A stored node wearing this pass's provenance. Noted HERE because the walk
    // is already happening: without it the composition-free fast path in
    // `resolveComponentInstances` returns the document untouched, which is
    // exactly the document where a false claim survives — a page with no
    // components at all.
    if ("instanceOf" in node) hasStoredProvenance = true;
    return "descend";
  });
  return { hasInstance, hasStoredProvenance, truncated, count, ids, domIds };
}

/** Every DOM id one stored node publishes, in either of the two places. */
function collectDomIds(node: Record<string, unknown>, into: Set<string>): void {
  const cssId = node.cssId;
  if (typeof cssId === "string" && cssId !== "") into.add(cssId);
  const attributes = node.attributes;
  if (!isPlainRecord(attributes)) return;
  const names = boundedOwnKeys(attributes, MAX_ENVELOPE_ENTRIES);
  if (names === null) return;
  for (const name of names) {
    if (name.toLowerCase() !== "id") continue;
    const value = ownEntry(attributes, name);
    if (typeof value === "string" && value !== "") into.add(value);
  }
}

/** The component a node references, or `undefined` if it references none. */
export function componentIdOf(node: unknown): string | undefined {
  if (!isPlainRecord(node) || node.type !== COMPONENT_INSTANCE_TYPE) {
    return undefined;
  }
  const props = node.props;
  if (!isPlainRecord(props)) return undefined;
  const id = props.componentId;
  return typeof id === "string" && id !== "" ? id : undefined;
}
