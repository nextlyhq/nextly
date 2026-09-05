/**
 * Inlining a linked component definition into the document that references it.
 *
 * A component INSTANCE is one node holding a reference, a variant name and a
 * set of overrides. What a reader has to draw is the definition's whole tree,
 * with those overrides applied and the instance's own slot content in place of
 * the definition's. Turning the first into the second is this module.
 *
 * ## Why the engine owns it, and only half of it
 *
 * Four consumers need a resolved tree and none of them is the renderer alone:
 * the canvas renders in the same document as the admin rather than in an
 * iframe, the class-usage index reads a resolved tree to know which classes a
 * page really applies, and SEO derivation reads one to find a page's heading.
 * A resolver living beside any one of them is reimplemented by the other three.
 *
 * The FETCH is deliberately not here. Only the stores know whether a caller
 * wants a draft definition or a published one, and that posture is the whole
 * difference between the editor's iframe and a served page. This module is
 * handed definitions and asks no questions about where they came from.
 *
 * ## What it guarantees
 *
 * - **Identity-preserving.** A document holding no instance comes back as the
 *   same object, so the ordinary page allocates nothing and a caller comparing
 *   stages by reference reads "unchanged" rather than "repaired".
 * - **Deterministic.** Every inlined node's id is derived from the instance and
 *   the definition node it came from, so two renders of one page produce the
 *   same ids. Styles, overlays, editor history and React keys all key on node
 *   ids; ids that changed per render would remount the tree on every request
 *   and detach every stylesheet rule from the markup it describes.
 * - **Per-instance failure.** A missing definition, a containment cycle, a
 *   nesting cap or an exhausted node budget leaves THAT instance unresolved and
 *   renders the rest of the page. Refusing the page would hand a visitor a
 *   blank screen for a fault in one region of it.
 *
 * ## What it does not do
 *
 * It does not evaluate bindings, prune hidden nodes, migrate, dedupe or drop
 * placeholders. Those are later stages of the read pipeline and they run over
 * the resolved tree — which is what makes a binding inside a definition resolve
 * against the HOST document's context, and a `visibility` exposure able to
 * decide whether a definition's node is served at all.
 *
 * @module resolve-instances
 */
import {
  COMPONENT_INSTANCE_TYPE,
  isComponentDocument,
  isUnsetOverride,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type NodeVisibility,
  type OverrideValue,
} from "./document";
import { walkForest } from "./forest-walk";
import { remapFragmentBindings, remapFragmentProps } from "./fragment-refs";
import {
  countNodes,
  DEFAULT_LIMITS,
  MAX_COMPOSED_DEPTH,
  MAX_ENVELOPE_ENTRIES,
  type DocumentLimits,
} from "./limits";
import { isPlainRecord } from "./plain-record";
import { boundedOwnKeys, defineEntry, ownEntry } from "./safe-record";
import { hashId } from "./style/node-class";
import { mintDomId, remapIdReferences } from "./tree";
import { isConditionGated } from "./visibility";

/**
 * Why an instance was left standing instead of being replaced by its
 * definition's tree.
 *
 * A closed list rather than a message, because each reason has a different
 * remedy and the surface showing it has to pick one: `missing` asks the author
 * to publish or restore a component, `cycle` asks them to break a containment
 * loop, `depth` and `budget` are limits, and `malformed` and `unreadable` are
 * document faults no author action fixes. A rendered string would carry the
 * same information in a form nothing can branch on and nothing can translate.
 */
export const COMPONENT_UNRESOLVED_REASONS = [
  /** No definition was supplied for the referenced id. */
  "missing",
  /** The component reaches itself through its own tree. */
  "cycle",
  /** Components nested inside components passed `MAX_COMPOSED_DEPTH`. */
  "composed-depth",
  /**
   * The definition's OWN tree is deeper than `limits.maxDepth`.
   *
   * Its own reason rather than sharing `composed-depth`, because the author's
   * remedy is the opposite one: flatten this component's content, rather than
   * stop nesting it inside others.
   */
  "node-depth",
  /** Inlining it would pass the run's node budget. */
  "budget",
  /** The instance node names no component at all. */
  "malformed",
  /**
   * A definition WAS supplied under this id and cannot be read — an envelope
   * this build does not understand, or a document that is not a component.
   *
   * Its own reason rather than sharing `malformed`, because the two point at
   * different documents. `malformed` is a fault in the page holding the
   * instance; this is a fault in the component the instance correctly names,
   * and a surface that cannot tell them apart sends whoever is debugging to
   * the healthy one. Both differ from `missing`, which asks somebody to
   * publish or restore a component that was never supplied.
   */
  "unreadable",
] as const;

/** Derived from the list, so the pair cannot be half-changed. */
export type ComponentUnresolvedReason =
  (typeof COMPONENT_UNRESOLVED_REASONS)[number];

/**
 * A node in a RESOLVED tree, which is not a node in a stored one.
 *
 * The two extra fields are render-time facts, so they extend `BlockNode`
 * rather than joining it. `BlockNode`'s key set is the stored format and is
 * frozen: a field added there is a field every external producer of a document
 * has to know about and every published schema has to describe, which is
 * exactly the wrong claim for a marker that never survives a save.
 */
export interface ResolvedBlockNode extends BlockNode {
  /**
   * The instance node, IN THE HOST DOCUMENT, this node was composed for.
   *
   * Set on every node that came from a definition, never on one an author
   * placed. It is the discrimination the editor cannot make any other way: an
   * instance's slot content is nested INSIDE the inlined tree and is the
   * page's own, so "sits under an inlined root" answers "is this editable?"
   * wrongly for exactly the nodes a marketer is there to edit.
   *
   * The HOST's instance at every depth, not the nearest one. A component that
   * holds another component is replaced by the tree it stands for, so its own
   * node is not in the resolved document and naming it would hand the editor
   * an id it cannot select — and the author never placed that inner instance
   * anyway; they placed the one on the page.
   */
  instanceOf?: string;
  /**
   * Why a component instance could not be inlined, set on the instance node
   * itself in place of the subtree it stands for.
   *
   * The instance node is KEPT rather than dropped, the way `migrationFailed`
   * keeps a node whose upgrade failed. A dropped instance is indistinguishable
   * from a page that never had one — so the editor could not offer "publish
   * this component", and an author would see a region silently missing with
   * nothing to act on.
   */
  unresolvedComponent?: ComponentUnresolvedReason;
  slots?: Record<string, ResolvedBlockNode[]>;
}

/** A document whose component instances have been resolved. */
export interface ResolvedDocument extends BlockDocument {
  nodes: ResolvedBlockNode[];
}

/**
 * The definitions a resolution may reach, keyed by document id.
 *
 * A `Map` rather than a record, and it is not a style preference. The keys are
 * component ids read from a stored document, and a plain record answers
 * `constructor` with a function on a key it never had — so a page referencing a
 * component called `constructor` would resolve against `Object.prototype`'s
 * method and inline whatever a property read of `.nodes` on it returned.
 */
export type DefinitionsById = ReadonlyMap<string, BlockDocument>;

/**
 * How a resolution reaches a definition.
 *
 * A lookup rather than the map itself, so that PREPARING a definition and
 * DECIDING to read one are the same act. A caller that repairs its definitions
 * up front has to predict which ones this run will reach, and reachability is
 * decided here: after an instance's overrides have chosen a component, under
 * the composition cap, over the tree the caller's own shape pass retained.
 * Every one of those is a place a second traversal answers differently, and a
 * disagreement costs the page a definition that WAS supplied.
 *
 * `has` and `get` are separate questions and both are asked. Absence means
 * nobody supplied a definition; a value that cannot be read means one was
 * supplied and is corrupt, and the reasons this module reports keep them
 * apart — so a lookup must not answer `has` from whether `get` produced
 * something.
 *
 * A `ReadonlyMap` satisfies it, which is what every caller holding its
 * definitions in memory passes.
 */
export interface ComponentLookup {
  /** Whether anybody supplied a definition under this id. */
  has(id: string): boolean;
  /** That definition, or nothing when it cannot be read. */
  get(id: string): BlockDocument | undefined;
}

/** How much work one resolution may do. */
export interface ResolveComponentOptions {
  /** Node and depth caps for the tree being built. Defaults to {@link DEFAULT_LIMITS}. */
  limits?: DocumentLimits;
  /** Levels of component nesting allowed. Defaults to {@link MAX_COMPOSED_DEPTH}. */
  maxComposedDepth?: number;
}

/** One instance that was left standing, and why. */
export interface UnresolvedInstance {
  /** The instance node's id, as it appears in the returned document. */
  instanceId: string;
  /** The component it referenced; empty when the node named none. */
  componentId: string;
  reason: ComponentUnresolvedReason;
}

/** What a resolution produced. */
export interface ResolvedComposition {
  /** The document with every resolvable instance inlined. */
  document: ResolvedDocument;
  /**
   * Every definition id this resolution READ, in first-reached order,
   * unresolvable ones included.
   *
   * Unresolvable ones belong in it because the list's consumer is cache
   * tagging: a page that failed to resolve a component because it is not
   * published yet must still regenerate when it IS, and a tag list built only
   * from successes is exactly the list that never recovers.
   */
  referenced: readonly string[];
  /** Every instance that could not be inlined. Empty on a clean resolution. */
  unresolved: readonly UnresolvedInstance[];
}

/**
 * The prefix every inlined node's id wears.
 *
 * Deliberately not a UUID shape. Stored ids are UUIDs, so a reader looking at a
 * resolved tree — in the DOM, in a React warning, in a stylesheet — can tell at
 * a glance which nodes exist in the stored document and which were composed for
 * this render, and nothing that persists an id can mistake one for the other.
 */
const SCOPED_ID_PREFIX = "cx-";

/**
 * How many dot segments of a `propPath` are followed.
 *
 * A bound on work rather than a design opinion. The path comes from a stored
 * definition that nothing here validated, and each segment costs a record copy.
 */
const MAX_PROP_PATH_SEGMENTS = 16;

/** The component ids a document references directly, in first-reached order. */
export function componentIdsIn(
  nodes: readonly unknown[],
  maxNodes: number = DEFAULT_LIMITS.maxNodes
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  let budget = maxNodes;
  walkForest(nodes, entry => {
    if (budget <= 0) return "stop";
    budget -= 1;
    const id = componentIdOf(entry.node);
    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
    return "descend";
  });
  return ids;
}

/**
 * Inline every component instance the document holds.
 *
 * @param document the host document, as stored
 * @param definitions the definitions to inline, at the posture the caller chose
 */
export function resolveComponentInstances(
  document: BlockDocument,
  definitions: ComponentLookup,
  options: ResolveComponentOptions = {}
): ResolvedComposition {
  const unchanged: ResolvedComposition = {
    document,
    referenced: [],
    unresolved: [],
  };
  if (!isPlainRecord(document) || !Array.isArray(document.nodes)) {
    return unchanged;
  }

  const limits = options.limits ?? DEFAULT_LIMITS;
  const survey = surveyHost(document.nodes, limits.maxNodes);
  // A survey that stopped at the cap collected a PREFIX of the document's ids,
  // so every id minted afterwards would be checked against a set missing
  // whatever the walk never reached — and an unread later node carrying a
  // minted id is exactly the duplicate the seeding exists to prevent. A
  // document past `maxNodes` is therefore composed not at all rather than up
  // to the cap: proceeding on a partial answer is worse than not composing.
  if (survey.truncated) return unchanged;
  // An optimisation, and stated as one because no test can hold it: identity
  // is already guaranteed by `inlineForest`, which returns its input array
  // when nothing changed, so removing this line changes no output. What it
  // saves is building the run and walking the tree at all, which is the whole
  // cost this module adds to a page that uses no components.
  if (!survey.hasInstance) return unchanged;

  const run: ResolveRun = {
    definitions,
    maxDepth: limits.maxDepth,
    maxNodes: limits.maxNodes,
    maxComposedDepth: options.maxComposedDepth ?? MAX_COMPOSED_DEPTH,
    // What is LEFT under the cap, not the cap itself. `maxNodes` bounds a
    // document, and the composed tree IS the document every later pass walks —
    // the style compiler, the renderer, the SEO derivation. Starting a fresh
    // allowance here would let a page at the cap resolve to twice it while
    // every one of those passes believes it is reading a bounded document.
    budget: limits.maxNodes - survey.count,
    taken: survey.ids,
    takenDomIds: survey.domIds,
    minted: [],
    mintedDomIds: [],
    abort: undefined,
    referenced: [],
    referencedSeen: new Set<string>(),
    unresolved: [],
    definitionsRead: new Map<
      string,
      ComponentDocument | ComponentUnresolvedReason
    >(),
  };
  const nodes = inlineForest(document.nodes, run, ROOT_SCOPE, 1);
  return {
    document: nodes === document.nodes ? document : { ...document, nodes },
    referenced: run.referenced,
    unresolved: run.unresolved,
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Everything one resolution accumulates. */
interface ResolveRun {
  definitions: ComponentLookup;
  maxDepth: number;
  /**
   * The document cap, kept beside the remaining budget rather than derived
   * from it. `budget` is what is LEFT, so a pass that needs to bound its own
   * work by the cap — the slot prepass does — cannot recover the cap from it.
   */
  maxNodes: number;
  maxComposedDepth: number;
  /** Nodes this resolution may still produce, across every instance. */
  budget: number;
  /** Every id in use, so a minted one cannot shadow a stored node. */
  taken: Set<string>;
  /** The same, for the ids that reach the DOM rather than the document. */
  takenDomIds: Set<string>;
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
interface ComposedScope {
  depth: number;
  onPath: ReadonlySet<string>;
}

const ROOT_SCOPE: ComposedScope = { depth: 0, onPath: new Set<string>() };

/** What the host document holds, read once before anything is rebuilt. */
interface HostSurvey {
  hasInstance: boolean;
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
function surveyHost(nodes: readonly unknown[], maxNodes: number): HostSurvey {
  const ids = new Set<string>();
  const domIds = new Set<string>();
  let hasInstance = false;
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
    return "descend";
  });
  return { hasInstance, truncated, count, ids, domIds };
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
function componentIdOf(node: unknown): string | undefined {
  if (!isPlainRecord(node) || node.type !== COMPONENT_INSTANCE_TYPE) {
    return undefined;
  }
  const props = node.props;
  if (!isPlainRecord(props)) return undefined;
  const id = props.componentId;
  return typeof id === "string" && id !== "" ? id : undefined;
}

// ---------------------------------------------------------------------------
// Walking the host document
// ---------------------------------------------------------------------------

/**
 * Rebuild a forest with its instances inlined.
 *
 * Recursive, with the depth cap checked before descending — the same shape the
 * renderer's own sanitizer uses, and for the same reason: this runs over a
 * document nothing validated, so a chain deeper than the format allows would
 * otherwise exhaust the call stack inside the helper meant to contain it.
 *
 * Returns the ORIGINAL array when nothing changed, which is what makes the
 * whole resolution identity-preserving for a page holding no instance.
 */
function inlineForest(
  nodes: readonly ResolvedBlockNode[],
  run: ResolveRun,
  scope: ComposedScope,
  depth: number
): ResolvedBlockNode[] {
  if (depth > run.maxDepth) return nodes as ResolvedBlockNode[];
  let changed = false;
  const out: ResolvedBlockNode[] = [];
  for (const node of nodes) {
    const replacement = inlineNode(node, run, scope, depth);
    if (replacement === null) {
      out.push(node);
      continue;
    }
    changed = true;
    for (const produced of replacement) out.push(produced);
  }
  return changed ? out : (nodes as ResolvedBlockNode[]);
}

/** What one host node becomes, or `null` when it is unchanged. */
function inlineNode(
  node: ResolvedBlockNode,
  run: ResolveRun,
  scope: ComposedScope,
  depth: number
): ResolvedBlockNode[] | null {
  if (!isPlainRecord(node)) return null;
  if (node.type === COMPONENT_INSTANCE_TYPE) {
    return expandInstance(node, run, scope, depth);
  }
  // The same rule `expandInstance` applies to an instance's OWN gate, applied
  // to the node holding one. Gating is inherited — `pruneHiddenNodes` drops a
  // gated node together with its whole subtree — so an instance under one
  // reaches no reader either way, and composing it is work nobody receives.
  //
  // Without this the two routes to one outcome report differently: the directly
  // gated instance is left standing with nothing recorded, while the instance
  // under a gated container is read, tagged and, when it cannot be composed,
  // listed as unresolved. A publish check then refuses a page over a component
  // no visitor can be served, and the tags a render invalidates on name it.
  //
  // Asked of the node ITSELF rather than tracked down the walk, because
  // `inlineForest` descends one level per frame: a gated node returns here
  // before its slots are visited, so nothing below it is ever reached.
  if (isConditionGated(node)) return null;
  const slots = node.slots;
  if (!isPlainRecord(slots)) return null;
  const next = inlineHostSlots(slots, run, scope, depth);
  return next === slots ? null : [{ ...node, slots: next }];
}

/** Every slot of a host node, with its children resolved in the same scope. */
function inlineHostSlots(
  slots: Record<string, ResolvedBlockNode[]>,
  run: ResolveRun,
  scope: ComposedScope,
  depth: number
): Record<string, ResolvedBlockNode[]> {
  let changed = false;
  // Read and written through an `unknown` view: a stored `slots` record can
  // hold anything, and a value that is not an array is PASSED ON rather than
  // replaced — dropping it would let an edit naming a different node destroy
  // content this package could not interpret.
  const stored = slots as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const name of Object.keys(stored)) {
    const children = ownEntry(stored, name);
    if (!Array.isArray(children)) {
      defineEntry(next, name, children);
      continue;
    }
    const inlined = inlineForest(
      children as ResolvedBlockNode[],
      run,
      scope,
      depth + 1
    );
    if (inlined !== children) changed = true;
    defineEntry(next, name, inlined);
  }
  return changed ? (next as Record<string, ResolvedBlockNode[]>) : slots;
}

// ---------------------------------------------------------------------------
// Expanding one instance
// ---------------------------------------------------------------------------

/** The definition's tree in place of one instance node, or the marked instance. */
function expandInstance(
  instance: ResolvedBlockNode,
  run: ResolveRun,
  scope: ComposedScope,
  depth: number,
  presupplied?: Record<string, ResolvedBlockNode[]>,
  owner?: string
): ResolvedBlockNode[] {
  // Asked before anything else, including whether the instance is even well
  // formed. A gated node is not served, so composing it is work nobody
  // receives — and reporting it would put an instance the reader never sees
  // into the list a publish check reads.
  //
  // The instance is returned STANDING, carrying its gate, so the pass that
  // prunes hidden nodes removes it and its whole subtree exactly as it would
  // any other gated node. Expanding it instead drops the gate on the floor:
  // the definition's roots replace the instance, none of them inherits it, and
  // the later pass sees a tree with nothing left to prune. That is the
  // direction `visibility.ts` names as the unrecoverable one — content shown
  // to a reader it was withheld from cannot be taken back.
  if (isConditionGated(instance)) return [instance];

  const componentId = componentIdOf(instance);
  if (componentId === undefined) {
    return [refuse(run, instance, "", "malformed")];
  }
  noteReference(run, componentId);

  const found = definitionFor(componentId, run, scope);
  if (typeof found === "string") {
    return [refuse(run, instance, componentId, found)];
  }
  const definition = found;

  // Taken before ANY speculative work, `suppliedSlots` included. Resolving an
  // instance's slot content spends budget and mints ids, and a refusal below
  // discards that content — `refuse` returns the instance with its STORED
  // slots — so a mark taken after it would leave a refused instance having
  // permanently charged the page for a tree nobody receives.
  const mark = savepoint(run);
  // The instance node is REPLACED, so its own slot under the cap is freed for
  // what replaces it. Credited before the clone rather than after, or a
  // definition that exactly fills the remaining room is refused for needing
  // one node more than the document will actually hold.
  run.budget += 1;
  // Picked, NOT composed. The page's slot content is composed where it is
  // PLACED, because a node the definition gates or an override hides discards
  // it — and composing first records the components inside it as read and as
  // unresolvable, for content no reader can receive. Nested content arrives
  // already composed and says so.
  const owned = presupplied === undefined;
  const supplied = owned
    ? suppliedSlots(instance, definition, run)
    : presupplied;
  const ctx: InlineContext = {
    run,
    scopeKey: instance.id,
    owner: owner ?? instance.id,
    domIds: new Map<string, string>(),
    plans: planEdits(definition, instance, supplied, !owned),
    scope: {
      depth: scope.depth + 1,
      onPath: new Set(scope.onPath).add(componentId),
    },
    hostScope: scope,
    hostDepth: depth,
  };

  // Before the clone rather than during it, so the room this content releases
  // is available to the whole definition instead of only to the nodes after
  // the slot. Nested content arrives composed already and needs no pass.
  composeOwnedSlots(definition, ctx, supplied, owned);
  const inlined = withRemappedIdReferences(
    cloneDefinitionForest(definition.nodes, ctx, 1),
    ctx
  );
  if (inlined === null) {
    const reason = run.abort ?? "budget";
    run.abort = undefined;
    rollback(run, mark);
    return [refuse(run, instance, componentId, reason)];
  }
  return withInstanceDevices(inlined, instance);
}

/**
 * Carry an instance's per-breakpoint hiding onto the roots that replace it.
 *
 * `devices` is NOT a gate — `isConditionGated` excludes it deliberately, since
 * per-breakpoint hiding is CSS applied to a node that is always served. So it
 * cannot be handled by leaving the instance standing; it has to travel, or an
 * author who hid a whole component on mobile silently gets it back.
 *
 * Only `false` propagates. The instance may hide what the definition shows; it
 * may not SHOW what the definition hid, because the definition's author made
 * that decision about their own content and an instance saying "visible at
 * mobile" is answering a different question.
 */
function withInstanceDevices(
  roots: ResolvedBlockNode[],
  instance: ResolvedBlockNode
): ResolvedBlockNode[] {
  // `isPlainRecord`, not `!== undefined`. A stored `visibility: null` is read
  // as UNGATED by `isConditionGated`, so a null envelope reaches this line on
  // the successful path and a direct property read throws — turning a
  // resolvable page into an exception.
  const envelope = instance.visibility;
  if (!isPlainRecord(envelope)) return roots;
  const devices = envelope.devices;
  if (!isPlainRecord(devices)) return roots;
  const hidden = boundedOwnKeys(devices, MAX_ENVELOPE_ENTRIES);
  if (hidden === null || hidden.length === 0) return roots;

  return roots.map(root => rootHiddenOn(root, devices, hidden));
}

/**
 * One definition root, carrying whatever the instance hides.
 *
 * The envelope is sorted into three cases, and they are three because
 * `isConditionGated` reads them as three:
 *
 * - **absent or `null`** — ungated to that predicate, so the flags merge into
 *   a fresh envelope. Refusing `null` here would silently drop the hiding an
 *   author asked for.
 * - **a plain record** — ungated or not on its own terms, and the flags merge
 *   into a copy of it.
 * - **anything else**, a string or an array — read as GATED, because an author
 *   wrote a restriction nothing can parse. Left exactly as it is. Rebuilding
 *   it as a record carrying only `devices` produces an envelope that same
 *   predicate calls unconditional, and the node is then served — the failure
 *   this whole function exists to prevent, reintroduced by the repair.
 */
function rootHiddenOn(
  root: ResolvedBlockNode,
  devices: Record<string, unknown>,
  hidden: readonly string[]
): ResolvedBlockNode {
  const own = root.visibility;
  const merged = mergeableDevices(own);
  if (merged === null) return root;
  if (!hideEach(merged, devices, hidden)) return root;
  return {
    ...root,
    visibility: {
      ...(own ?? {}),
      devices: merged as Record<string, boolean>,
    },
  };
}

/**
 * The device map to merge into, or `null` when the envelope must not be
 * touched at all.
 *
 * `null` is the third case above: an envelope `isConditionGated` reads as
 * gated, which this must leave exactly as it found.
 */
function mergeableDevices(
  own: NodeVisibility | null | undefined
): Record<string, unknown> | null {
  if (own !== undefined && own !== null && !isPlainRecord(own)) return null;
  return isPlainRecord(own?.devices) ? { ...own.devices } : {};
}

/**
 * Write the instance's per-breakpoint setting into the map, reporting whether
 * anything moved.
 *
 * BOTH values travel, not only `false`, and that is the correction: hiding
 * INHERITS to narrower breakpoints until a `true` ends the band. So
 * `{ tablet: false, mobile: true }` means "hidden from tablet down to mobile,
 * shown again at mobile", and copying only the `false` hides the component
 * everywhere below tablet — further than the author asked, from a rule meant
 * to be conservative.
 *
 * A `true` is still refused where the definition's own map says `false` at
 * that same breakpoint, so an instance cannot re-show what the component's
 * author explicitly hid.
 *
 * The residual gap is stated rather than hidden: a definition that hid a WIDER
 * breakpoint hides the narrower ones by inheritance rather than by an entry,
 * so an instance's band-ending `true` can end that inherited band too.
 * Closing it needs the breakpoints in order, and this module has no style
 * context by design — the engine is the place where composition is pure. The
 * alternative, dropping every `true`, corrupts every bounded band, which is
 * the ordinary way responsive visibility is authored.
 */
function hideEach(
  merged: Record<string, unknown>,
  devices: Record<string, unknown>,
  named: readonly string[]
): boolean {
  let changed = false;
  for (const id of named) {
    const wanted = ownEntry(devices, id);
    if (typeof wanted !== "boolean") continue;
    if (wanted && ownEntry(merged, id) === false) continue;
    if (ownEntry(merged, id) === wanted) continue;
    defineEntry(merged, id, wanted);
    changed = true;
  }
  return changed;
}

/**
 * Point the inlined tree's id REFERENCES at where those ids ended up.
 *
 * A second pass, after every node has been minted, because a node may
 * reference an id defined on one the walk had not reached yet — rewriting
 * during the copy would leave every forward reference pointing at the
 * original. `aria-labelledby` and `aria-describedby` are how a control is
 * named and described to a screen reader, and a reference to an id that no
 * longer exists is ignored in silence: the element simply loses its name,
 * visibly to nobody who is not using assistive technology.
 */
function withRemappedIdReferences(
  roots: ResolvedBlockNode[] | null,
  ctx: InlineContext
): ResolvedBlockNode[] | null {
  if (roots === null || ctx.domIds.size === 0) return roots;
  const rewrite = (nodes: ResolvedBlockNode[]): ResolvedBlockNode[] =>
    nodes.map(node => {
      // DEFINITION-owned nodes only, and the walk stops at anything else. An
      // unmarked node is slot content the page supplied, so its references
      // address the page's own ids — rewriting them against this definition's
      // map redirects a working relationship at a node the author never
      // named. Its descendants are page content too, and any component nested
      // among them was rewritten by its own expansion with its own map, so
      // descending would rewrite those a second time.
      if (node.instanceOf === undefined) return node;
      const attributes = isPlainRecord(node.attributes)
        ? remapIdReferences(node.attributes, ctx.domIds)
        : node.attributes;
      const props = remapFragmentProps(node.props, ctx.domIds) as Record<
        string,
        unknown
      >;
      // The BOUND form of the same field, for the same reason: a bound `href`
      // renders `bindings.href.fallback` when its source is empty, so a
      // fallback left behind points at an id this composition has re-minted.
      const bindings = remapFragmentBindings(
        node.bindings,
        ctx.domIds
      ) as ResolvedBlockNode["bindings"];
      const slots = isPlainRecord(node.slots)
        ? rewriteSlots(node.slots)
        : node.slots;
      if (
        attributes === node.attributes &&
        slots === node.slots &&
        props === node.props &&
        bindings === node.bindings
      ) {
        return node;
      }
      return { ...node, attributes, props, bindings, slots };
    });
  const rewriteSlots = (
    slots: Record<string, ResolvedBlockNode[]>
  ): Record<string, ResolvedBlockNode[]> => {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const name of Object.keys(slots)) {
      const children = ownEntry(slots, name);
      if (!Array.isArray(children)) {
        defineEntry(next, name, children);
        continue;
      }
      const rewritten = rewrite(children);
      if (rewritten !== children) changed = true;
      defineEntry(next, name, rewritten);
    }
    return changed ? (next as Record<string, ResolvedBlockNode[]>) : slots;
  };
  return rewrite(roots);
}

/** Everything one speculative expansion may have to give back. */
interface Savepoint {
  budget: number;
  unresolved: number;
  minted: number;
  mintedDomIds: number;
}

/** Where the run stood before an instance was attempted. */
function savepoint(run: ResolveRun): Savepoint {
  return {
    budget: run.budget,
    unresolved: run.unresolved.length,
    minted: run.minted.length,
    mintedDomIds: run.mintedDomIds.length,
  };
}

/**
 * Undo a whole attempted expansion.
 *
 * All three, not the budget alone. A nested instance refused INSIDE an
 * expansion that is itself then refused has already reported itself, and that
 * report names a scoped id no node in the returned document carries — a
 * diagnostic about a tree the reader never receives, which is worse than
 * silence because a surface will offer the author a remedy for it. The minted
 * ids go back for the same reason: an id reserved for a node that does not
 * exist pushes a later, real node onto a disambiguated spelling.
 *
 * `referenced` is deliberately NOT rolled back. Its consumer is cache tagging,
 * and this page's render DID read that definition — a change to it can change
 * whether this instance fits the budget at all, so the page has to regenerate.
 * A tag list trimmed to what survived is the list that never recovers.
 */
function rollback(run: ResolveRun, mark: Savepoint): void {
  run.budget = mark.budget;
  run.unresolved.length = mark.unresolved;
  for (let i = run.minted.length - 1; i >= mark.minted; i -= 1) {
    run.taken.delete(run.minted[i]);
  }
  run.minted.length = mark.minted;
  for (let i = run.mintedDomIds.length - 1; i >= mark.mintedDomIds; i -= 1) {
    run.takenDomIds.delete(run.mintedDomIds[i]);
  }
  run.mintedDomIds.length = mark.mintedDomIds;
}

/**
 * The definition to inline here, or why this instance cannot be.
 *
 * One value rather than a verdict the caller then re-reads, because the lookup
 * is a caller's object and nothing in its contract makes it pure. Validating
 * one `get` and expanding a second means the document that was checked is not
 * the document that is used — and the source that FETCHES is the one least
 * likely to answer twice the same way. Reasons are strings and definitions are
 * records, so the two are told apart without an envelope per instance.
 */
function definitionFor(
  componentId: string,
  run: ResolveRun,
  scope: ComposedScope
): ComponentDocument | ComponentUnresolvedReason {
  if (scope.onPath.has(componentId)) return "cycle";
  if (scope.depth >= run.maxComposedDepth) return "composed-depth";
  const seen = run.definitionsRead.get(componentId);
  if (seen !== undefined) return seen;
  const answer = readDefinition(componentId, run);
  run.definitionsRead.set(componentId, answer);
  return answer;
}

/**
 * What the lookup says about one component, asked once per run.
 *
 * Split from the scope checks above so that only the id-dependent half is
 * remembered: a component refused for a cycle at one position is perfectly
 * resolvable at another, and caching that refusal would withhold it there.
 */
function readDefinition(
  componentId: string,
  run: ResolveRun
): ComponentDocument | ComponentUnresolvedReason {
  // ABSENT from the map is `missing` — nobody supplied one, and the remedy is
  // to publish or restore it. A value that IS supplied and cannot be read is a
  // document fault, so it takes `unreadable`: offering the publish remedy for
  // corrupt component data sends an author to the wrong screen, which is the
  // whole reason these reasons are a closed list rather than a message.
  if (!run.definitions.has(componentId)) return "missing";
  // Read ONCE and carried out, so expansion never asks again.
  const definition = run.definitions.get(componentId);
  if (!isPlainRecord(definition) || !Array.isArray(definition.nodes)) {
    return "unreadable";
  }
  // A structural check is not the discrimination. `DefinitionsById` is keyed to
  // `BlockDocument`, so a page, a region or a template satisfies "has a nodes
  // array" and would be inlined as though it were a component — content from
  // another document appearing inside this one, with its exposed properties
  // and slots meaning nothing. The kind is what the engine already publishes
  // an answer for.
  if (!isComponentDocument(definition)) return "unreadable";
  return definition;
}

/**
 * Keep the instance node, marked with why it is still standing.
 *
 * Kept rather than dropped so the editor has something to attach "publish this
 * component" to, and so a reader can tell a page that lost a region from one
 * that never had it. Its stored slot content travels with it untouched: a
 * placeholder draws no children, and rewriting content that is not being shown
 * would be an edit made by a failure.
 */
function refuse(
  run: ResolveRun,
  instance: ResolvedBlockNode,
  componentId: string,
  reason: ComponentUnresolvedReason
): ResolvedBlockNode {
  run.unresolved.push({ instanceId: instance.id, componentId, reason });
  return { ...instance, unresolvedComponent: reason };
}

/** Record a definition this resolution read, once. */
function noteReference(run: ResolveRun, componentId: string): void {
  if (run.referencedSeen.has(componentId)) return;
  run.referencedSeen.add(componentId);
  run.referenced.push(componentId);
}

/**
 * The instance's own slot content, PICKED and not composed.
 *
 * The name says whose content this is, not what state it is in, so the state
 * has to be said here: what comes back is stored nodes. `placedContent`
 * composes them, and only once the node they are bound for has survived —
 * content aimed at a gated or overridden-away target is discarded, and
 * composing it first spends the page's budget on a tree nobody receives, mints
 * ids for it, and records the components inside it as read and as
 * unresolvable.
 *
 * Composed in the OUTER scope when it is composed, because this content
 * belongs to the page rather than to the component: a component nested in it
 * is nested in the page, not one level further into the composition, and
 * re-identifying it would move page nodes to ids the editor cannot address.
 */
function suppliedSlots(
  instance: ResolvedBlockNode,
  definition: ComponentDocument,
  run: ResolveRun
): Record<string, ResolvedBlockNode[]> | undefined {
  const slots = instance.slots;
  if (!isPlainRecord(slots)) return undefined;
  return exposedSlotContent(slots, definition, run);
}

/**
 * The instance's slot content, narrowed to the slots the definition still has.
 *
 * Narrowed BEFORE it is resolved, which is the whole point. An author who
 * removed an exposed slot leaves every instance holding content under a key
 * nothing will insert; resolving it first spends the page's node budget on a
 * tree nobody receives, mints ids for it, and records a diagnostic naming a
 * node absent from the returned document — so a large enough orphan can refuse
 * the visible instance that contains it.
 *
 * The content is KEPT in the stored instance regardless. This decides what a
 * render walks, not what an author owns: re-exposing the slot must bring the
 * content back.
 */
function exposedSlotContent(
  slots: Record<string, ResolvedBlockNode[]>,
  definition: ComponentDocument,
  run: ResolveRun
): Record<string, ResolvedBlockNode[]> | undefined {
  const exposed = isPlainRecord(definition.slots) ? definition.slots : {};
  const ids = boundedOwnKeys(exposed, MAX_ENVELOPE_ENTRIES);
  refundDiscardedSlots(slots, new Set(ids ?? []), run);
  if (ids === null || ids.length === 0) return undefined;

  const wanted: Record<string, ResolvedBlockNode[]> = {};
  let any = false;
  for (const id of ids) {
    const content = ownEntry(slots, id);
    if (content === undefined) continue;
    any = true;
    defineEntry(wanted, id, content);
  }
  return any ? wanted : undefined;
}

/**
 * Give back the budget charged for slot content this composition discards.
 *
 * The host survey counts every node the document holds and the budget is what
 * is LEFT under the cap after it, so content under a slot the definition no
 * longer exposes is charged for and then dropped — and the page is refused
 * room for a component whose result would have fitted. Refunded here rather
 * than subtracted in the survey because only the definition knows which keys
 * survive, and the survey runs before any definition is read.
 *
 * The savepoint covers it. If the instance is then refused, its stored slots
 * travel with it into the result, and the refund is rolled back along with
 * everything else so those nodes stay charged exactly as they should.
 */
function refundDiscardedSlots(
  slots: Record<string, ResolvedBlockNode[]>,
  kept: ReadonlySet<string>,
  run: ResolveRun
): void {
  for (const name of Object.keys(slots)) {
    if (kept.has(name)) continue;
    const children = ownEntry(slots, name);
    if (!Array.isArray(children)) continue;
    run.budget += countNodes(children);
  }
}

// ---------------------------------------------------------------------------
// What an instance changes about the definition's nodes
// ---------------------------------------------------------------------------

/** One override, resolved to the node prop it writes. */
interface PropEdit {
  path: string;
  value: OverrideValue;
  /** Clear the prop rather than replace it. */
  unset: boolean;
}

/** Everything one instance changes about one node of the definition. */
interface NodePlan {
  props: PropEdit[];
  /** `false` drops the node; `true` serves it unconditionally; absent leaves it alone. */
  visible?: boolean;
  /** Instance content, keyed by the slot NAME on this node. */
  slots?: Map<string, PlannedSlot>;
}

/**
 * Content bound for one slot, and whether it has been composed yet.
 *
 * The flag exists because two different things arrive here. The PAGE's own
 * slot content is stored and has to be composed in the host's scope — and is
 * composed only if the node it is bound for survives, since a gated or
 * overridden-away target discards it and composing it first records the
 * components inside it as read and as unresolvable, for content no reader
 * receives. A NESTED instance's content arrives already composed in its
 * component's scope, and composing it again would re-mint every id in it.
 */
interface PlannedSlot {
  nodes: ResolvedBlockNode[];
  composed: boolean;
}

/** What each of the definition's nodes gets, keyed by its id in the definition. */
function planEdits(
  definition: ComponentDocument,
  instance: ResolvedBlockNode,
  supplied: Record<string, ResolvedBlockNode[]> | undefined,
  composed: boolean
): Map<string, NodePlan> {
  const plans = new Map<string, NodePlan>();
  const values = effectiveOverrides(definition, instance);
  if (values.size > 0) planExposed(definition.exposed, values, plans);
  if (supplied !== undefined) {
    planSlots(definition.slots, supplied, plans, composed);
  }
  return plans;
}

/**
 * The variant's overrides with the instance's own written over them.
 *
 * That order, not the reverse: a variant is a preset the definition offers and
 * an instance's own value is the author's answer to it. Writing the preset last
 * would make selecting a variant silently discard edits already made.
 */
function effectiveOverrides(
  definition: ComponentDocument,
  instance: ResolvedBlockNode
): Map<string, OverrideValue> {
  const values = new Map<string, OverrideValue>();
  const props = isPlainRecord(instance.props) ? instance.props : {};
  collectOverrides(variantOverrides(definition, props.variant), values);
  collectOverrides(props.overrides, values);
  return values;
}

/** The chosen variant's override record, if the definition offers it. */
function variantOverrides(
  definition: ComponentDocument,
  variant: unknown
): unknown {
  if (typeof variant !== "string" || variant === "") return undefined;
  const variants = definition.variants;
  if (!isPlainRecord(variants)) return undefined;
  const chosen = ownEntry(variants as Record<string, unknown>, variant);
  return isPlainRecord(chosen) ? chosen.overrides : undefined;
}

/** Fold one override record into the accumulator; later callers win. */
function collectOverrides(
  source: unknown,
  into: Map<string, OverrideValue>
): void {
  if (!isPlainRecord(source)) return;
  // Bounded during the walk, not after it. `Object.keys` on a record with a
  // hundred thousand keys allocates all of them before a budget checked in the
  // loop body gets a turn, so the cap would bound the work done PER key and
  // nothing at all about reaching them.
  const keys = boundedOwnKeys(source, MAX_ENVELOPE_ENTRIES);
  if (keys === null) return;
  for (const key of keys) into.set(key, ownEntry(source, key));
}

/** Turn overridden exposure ids into per-node edits. */
function planExposed(
  exposed: unknown,
  values: ReadonlyMap<string, OverrideValue>,
  plans: Map<string, NodePlan>
): void {
  if (!Array.isArray(exposed)) return;
  const count = Math.min(exposed.length, MAX_ENVELOPE_ENTRIES);
  for (let i = 0; i < count; i += 1) {
    const entry: unknown = exposed[i];
    if (!isPlainRecord(entry)) continue;
    const id = entry.id;
    const nodeId = entry.nodeId;
    if (typeof id !== "string" || !values.has(id)) continue;
    if (typeof nodeId !== "string" || nodeId === "") continue;
    applyExposure(planFor(plans, nodeId), entry, values.get(id));
  }
}

/** Write one exposure's override into the plan for its node. */
function applyExposure(
  plan: NodePlan,
  entry: Record<string, unknown>,
  value: OverrideValue
): void {
  if (entry.type === "visibility") {
    const decided = visibilityDecision(value);
    if (decided !== undefined) plan.visible = decided;
    return;
  }
  const path = entry.propPath;
  if (typeof path !== "string" || !isUsablePropPath(path)) return;
  plan.props.push({ path, value, unset: isUnsetOverride(value) });
}

/**
 * What a `visibility` override decides, or nothing.
 *
 * Booleans only. An override is a value an author's inspector wrote and a
 * `visibility` control writes `true` or `false`; coercing every other value
 * would let a stored `"false"` — or an image object left behind when an
 * exposure changed type — decide whether a region of the page is served.
 * Clearing it hides, because that is what "renders empty" means for a node.
 */
function visibilityDecision(value: OverrideValue): boolean | undefined {
  if (value === true) return true;
  if (value === false || isUnsetOverride(value)) return false;
  return undefined;
}

/** Route instance slot content to the definition node and slot it fills. */
function planSlots(
  slots: unknown,
  supplied: Record<string, ResolvedBlockNode[]>,
  plans: Map<string, NodePlan>,
  composed: boolean
): void {
  if (!isPlainRecord(slots)) return;
  const ids = boundedOwnKeys(slots, MAX_ENVELOPE_ENTRIES);
  if (ids === null) return;
  for (const id of ids) {
    const content = ownEntry(supplied, id);
    const target = slotTarget(ownEntry(slots, id));
    if (!Array.isArray(content) || target === undefined) continue;
    const plan = planFor(plans, target.nodeId);
    const into = plan.slots ?? new Map<string, PlannedSlot>();
    plan.slots = into;
    into.set(target.slot, { nodes: content, composed });
  }
}

/** The node and slot one exposed-slot declaration points at. */
function slotTarget(
  spec: unknown
): { nodeId: string; slot: string } | undefined {
  if (!isPlainRecord(spec)) return undefined;
  const { nodeId, slot } = spec;
  if (typeof nodeId !== "string" || nodeId === "") return undefined;
  if (typeof slot !== "string" || slot === "") return undefined;
  return { nodeId, slot };
}

/** The plan for one definition node, created on first use. */
function planFor(plans: Map<string, NodePlan>, nodeId: string): NodePlan {
  const existing = plans.get(nodeId);
  if (existing !== undefined) return existing;
  const created: NodePlan = { props: [] };
  plans.set(nodeId, created);
  return created;
}

// ---------------------------------------------------------------------------
// Cloning the definition under the instance's identity
// ---------------------------------------------------------------------------

/** One instance's inlining, in progress. */
interface InlineContext {
  run: ResolveRun;
  /**
   * What ids produced here are derived from: the NEAREST instance.
   *
   * Separate from `owner` because they answer different questions. Deriving
   * from the nearest instance is what keeps two components that happen to
   * share a node id apart; recording the nearest instance would name a node
   * the reader cannot find, since a nested instance is itself replaced by the
   * tree it stands for.
   */
  scopeKey: string;
  /**
   * What `instanceOf` records: the instance in the HOST DOCUMENT.
   *
   * Always a node the stored document contains, which is the whole use — the
   * editor holds the stored document and needs a click on a composed node to
   * select something it can address. The nearest-instance answer is unusable
   * for that at any depth below the first.
   */
  owner: string;
  plans: ReadonlyMap<string, NodePlan>;
  /**
   * Original DOM id to its replacement, for this instance.
   *
   * Asked once per distinct ORIGINAL, so a definition whose two nodes carry
   * one DOM id maps both to a single replacement — the pair pointed at one
   * target before and still reaches one target after. The same memo
   * `reidSubtreeWithMap` keeps, for the same reason.
   */
  domIds: Map<string, string>;
  /** The scope INSIDE this component, for instances the definition itself holds. */
  scope: ComposedScope;
  /**
   * Where the HOST document's own slot content composes.
   *
   * The page's content stays the page's wherever the definition places it, so
   * it is composed at the host's scope and depth rather than the component's —
   * the same answer the eager pass gave, arrived at later.
   */
  hostScope: ComposedScope;
  hostDepth: number;
}

/**
 * A definition's forest, re-identified under one instance.
 *
 * `null` means the run's node budget was exhausted, which the caller turns into
 * a refusal for the whole instance. It is not the same as an empty array: a
 * definition whose nodes were all hidden by an override legitimately draws
 * nothing.
 */
function cloneDefinitionForest(
  nodes: readonly unknown[],
  ctx: InlineContext,
  depth: number
): ResolvedBlockNode[] | null {
  // A refusal rather than an empty forest. Returning `[]` publishes a
  // component whose deeper content is silently gone, with nothing in
  // `unresolved` to say so — the truncation Storyblok is criticised for in the
  // design's prior art, arrived at by accident.
  if (depth > ctx.run.maxDepth) {
    ctx.run.abort = "node-depth";
    return null;
  }
  const out: ResolvedBlockNode[] = [];
  for (const node of nodes) {
    // Charged BEFORE the entry is judged, the way `countNodes` counts every
    // entry including malformed ones. A definition nothing validated can hold
    // a million nulls, and skipping them free lets it be walked in full under
    // any cap — then resolve to a partial tree rather than reporting `budget`.
    if (ctx.run.budget <= 0) {
      ctx.run.abort = "budget";
      return null;
    }
    ctx.run.budget -= 1;
    if (!isPlainRecord(node) || typeof node.id !== "string") continue;
    const produced = cloneDefinitionNode(
      node as unknown as ResolvedBlockNode,
      ctx,
      depth
    );
    if (produced === null) return null;
    // Charged on the way in and given back when nothing came out. A node an
    // override hides emits no markup, so charging for it refuses an expansion
    // whose result would have fitted — the cap is on the composed DOCUMENT,
    // not on how many nodes were considered.
    if (produced.length === 0) ctx.run.budget += 1;
    for (const child of produced) out.push(child);
  }
  return out;
}

/** One definition node, scoped, edited, and expanded if it is itself an instance. */
function cloneDefinitionNode(
  node: ResolvedBlockNode,
  ctx: InlineContext,
  depth: number
): ResolvedBlockNode[] | null {
  const plan = ctx.plans.get(node.id);
  if (plan?.visible === false) {
    // The node goes and its slots go with it, INSTANCE-SUPPLIED content
    // included — which the host survey already charged for. Without this the
    // page pays for a subtree nobody receives, and a later visible root is
    // refused for room the hidden one freed.
    refundPlannedSlots(plan, ctx.run);
    return [];
  }

  const scoped = scopeNode(node, ctx, plan);

  // The inherited-gate rule, on the definition side. `inlineNode` applies it to
  // a host container; a definition's own gated box is dropped by the same pass
  // with the same subtree, so descending here would report components no reader
  // can receive — and the host rule would mean nothing for anything a component
  // holds.
  //
  // Asked AFTER `scopeNode` rather than of the stored node, because an
  // instance's `visibility` override is allowed to remove the gate: asking
  // first would refuse to compose a region the instance explicitly turned on.
  // `scopeNode` deletes the envelope for `plan.visible === true`, so by here
  // the question has one answer.
  //
  // The node stands, gated, exactly as the host case leaves it standing — the
  // pass that prunes it wants it there — and its planned slot content is given
  // back, because nothing will place it.
  if (!survivesGating(node, plan)) {
    if (plan !== undefined) refundPlannedSlots(plan, ctx.run);
    return [scoped];
  }

  // Cloned BEFORE the instance branch, not after it. A component-instance node
  // inside a definition carries slot content like any container, and skipping
  // this for it left that content holding the DEFINITION's own node ids — so
  // two instances of the outer component published the same ids — and left a
  // planned slot substitution aimed at the nested instance unapplied, so
  // page-supplied content lost to the definition's default.
  const slots = cloneSlots(node, ctx, depth, plan);
  if (slots === null) return null;
  if (slots !== undefined) scoped.slots = slots;

  if (scoped.type === COMPONENT_INSTANCE_TYPE) {
    // Handed on rather than re-derived: these children are already resolved in
    // this component's scope, and asking `expandInstance` to read them again
    // would walk a tree that holds no instance left to expand.
    return expandInstance(
      scoped,
      ctx.run,
      ctx.scope,
      depth,
      slots ?? {},
      ctx.owner
    );
  }
  return [scoped];
}

/**
 * Compose the page's slot content for every target the clone will reach.
 *
 * Deferring composition to the moment content is PLACED is what stops a gated
 * or hidden target from paying for a tree nobody receives — but placement
 * happens partway through cloning the definition, and replacing an instance
 * RELEASES budget. So a page whose composed tree fits exactly was refused for
 * `budget` when a sibling cloned before the slot target spent the room the
 * content was about to give back, and whether it fit depended on where the
 * author happened to put the slot in the definition.
 *
 * Composing the surviving targets' content up front restores that order
 * without restoring the waste: survivorship is decided by `survivesGating`,
 * which is the same question the clone asks, so discarded content is still
 * never composed. `placedContent` marks what it composes, so the clone reuses
 * this work rather than repeating it.
 *
 * Bounded by the definition's own depth, mirroring the clone. A definition
 * deeper than the cap stops here and the clone refuses it a moment later.
 */
function composeSurvivingSlots(
  nodes: readonly ResolvedBlockNode[],
  ctx: InlineContext,
  depth: number,
  work: WorkBudget
): void {
  if (depth > ctx.run.maxDepth) return;
  for (const node of nodes) {
    // Charged before the entry is judged, the way the clone charges. A
    // definition nothing validated can hold a million siblings, and the depth
    // bound says nothing about breadth — so without this the pass walks all of
    // them to prepare content the clone refuses a moment later for `budget`.
    if (work.left <= 0) return;
    work.left -= 1;
    if (!isPlainRecord(node) || typeof node.id !== "string") continue;
    const plan = ctx.plans.get(node.id);
    if (!survivesGating(node, plan)) {
      // Refunded for the OVERRIDE only, because that is the one the clone
      // refunds. The two ways a node stops being served end differently there:
      // an override that hides emits nothing and the charge comes back, while
      // a condition-gated node is emitted STANDING — the pass that prunes it
      // wants it there — and its charge stays spent.
      //
      // Mirroring the wrong one is not a rounding error in either direction.
      // Refunding neither stops this pass before a slot target in a definition
      // whose leading nodes are all overridden away, and the content it did
      // not reach is composed at placement — the ordering this pass exists to
      // fix, arriving back as a refusal. Refunding both lets an arbitrarily
      // wide gated definition be read for free, which is the breadth bound
      // gone.
      if (plan?.visible === false) work.left += 1;
      continue;
    }
    composePlannedFor(plan, ctx);
    composeSlotsUnder(node, plan, ctx, depth, work);
  }
}

/**
 * How many entries the slot prepass may still visit.
 *
 * Its own counter rather than the run's node budget, because they measure
 * different things: the run's is what the composed DOCUMENT may still hold,
 * and spending it here would refuse a page for nodes it never produced.
 * Running out is safe — the content it did not reach is composed at placement
 * as it was before, so the bound costs the ordering benefit for that content
 * and never the content itself.
 */
interface WorkBudget {
  left: number;
}

/** The content bound for one surviving node, composed where it will be placed. */
function composePlannedFor(
  plan: NodePlan | undefined,
  ctx: InlineContext
): void {
  if (plan?.slots === undefined) return;
  for (const content of plan.slots.values()) placedContent(content, ctx);
}

/**
 * Compose again anything a sibling slot has since made room for.
 *
 * Slots are composed in the order the definition declares them, and replacing
 * an instance hands back the node it occupied — so a slot filled with content
 * that GROWS can be refused for budget before a slot filled with content that
 * SHRINKS has released anything. Whether a page fits then depends on the order
 * its author happened to declare two independent slots in.
 *
 * The answer is to RETRY rather than to predict. An earlier attempt lent the
 * budget the room the replacements were expected to free, counted from the
 * stored content — and an instance that turns out to be missing, gated or
 * over-deep never returns that credit, so repayment left debt and a child's
 * refusal escalated into its owner's. Credit has to be earned before it is
 * spent.
 *
 * Retrying costs nothing to state: a refused instance is left STANDING with
 * its marker, so the composed content still holds it and `inlineForest` will
 * expand it if it fits now. One extra pass, and only over slots that actually
 * hold a starved instance.
 */
function retryStarvedPlans(ctx: InlineContext, mark: number): void {
  let retried = false;
  for (const plan of ctx.plans.values()) {
    for (const content of plan.slots?.values() ?? []) {
      if (!content.composed) continue;
      const next = retriedRoots(content.nodes, ctx);
      if (next === content.nodes) continue;
      content.nodes = next;
      retried = true;
    }
  }
  if (retried) reconcileRefusals(ctx, mark);
}

/**
 * Make the refusal list agree with what the retry actually produced.
 *
 * A retry rewrites the tree and cannot rewrite what was already recorded, so
 * two things need fixing afterwards. An instance that fits on the second
 * attempt left a `budget` entry behind claiming it failed — a publish check
 * reading that reports a problem the page does not have. And one that fails
 * again recorded a second entry saying what the first already said.
 *
 * Only this node's own segment is touched. Entries before `mark` belong to
 * earlier work and are none of this pass's business, which is why the mark is
 * taken rather than the whole list rebuilt.
 */
function reconcileRefusals(ctx: InlineContext, mark: number): void {
  const run = ctx.run;
  const standing = new Set<string>();
  for (const plan of ctx.plans.values()) {
    for (const content of plan.slots?.values() ?? []) {
      if (!content.composed) continue;
      collectRefusedIds(content.nodes, standing);
    }
  }
  // First-seen ORDER with the last-written VALUE. A retry appends, so keeping
  // the appended position would move a retried instance to the end of a list
  // whose usefulness is that it reads in document order — while keeping the
  // first VALUE would report the attempt the retry superseded.
  const { order, latest } = lastPerInstance(run.unresolved, mark);

  run.unresolved.length = mark;
  for (const id of order) {
    const entry = latest.get(id);
    if (entry === undefined) continue;
    // A refusal for want of budget is the only kind a retry can settle: every
    // other reason is a decision the second attempt reaches identically, so an
    // instance refused for one is still standing afterwards and still in
    // `standing`.
    //
    // Which means no test separates this from dropping every reason whose node
    // has gone — removing the check leaves the suite green. It is kept because
    // the two failures are not symmetric. A spurious entry reports a problem
    // the page does not have, and someone reading the list can see the page is
    // fine; a dropped one takes a real diagnostic away, and nothing is left to
    // notice. If a retry ever does make a non-budget refusal disappear, this is
    // the direction to fail in.
    if (entry.reason === "budget" && !standing.has(id)) continue;
    run.unresolved.push(entry);
  }
}

/**
 * One entry per instance from `mark` on: first-seen ORDER, last-written VALUE.
 *
 * A retry appends, so the appended position would move a retried instance to
 * the end of a list whose usefulness is that it reads in document order —
 * while the first value would report the attempt the retry superseded.
 */
function lastPerInstance(
  entries: readonly UnresolvedInstance[],
  mark: number
): { order: string[]; latest: Map<string, UnresolvedInstance> } {
  const order: string[] = [];
  const latest = new Map<string, UnresolvedInstance>();
  for (let i = mark; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!latest.has(entry.instanceId)) order.push(entry.instanceId);
    latest.set(entry.instanceId, entry);
  }
  return { order, latest };
}

/** The ids of every instance still standing with a marker in this forest. */
function collectRefusedIds(
  nodes: readonly ResolvedBlockNode[],
  into: Set<string>
): void {
  walkForest(nodes, entry => {
    const node = entry.node;
    if (
      isPlainRecord(node) &&
      node.unresolvedComponent !== undefined &&
      typeof node.id === "string"
    ) {
      into.add(node.id);
    }
    return "descend";
  });
}

/**
 * This slot's content with its ROOT starved instances expanded again.
 *
 * Roots only, and that bound is the whole care in this function. A starved
 * instance sitting deeper was reached under some other instance's scope and
 * owner — inside a component that has already expanded — and re-entering the
 * composed forest from here would retry it as though the PAGE had held it: its
 * output would record `instanceOf` for a scoped node the editor cannot select,
 * and the reset path and depth could answer the cycle and nesting questions
 * differently than the position it actually occupies.
 *
 * A root of this content is unambiguous: the page supplied it, so the host
 * scope and depth ARE the ones it was reached under, and expanding it again is
 * the same call with the same arguments. A deeper one is left standing, which
 * is what it did before any retry existed.
 *
 * Returns the input array unchanged when nothing was retried, so a caller can
 * tell by identity whether the refusal list needs reconciling.
 */
function retriedRoots(
  nodes: readonly ResolvedBlockNode[],
  ctx: InlineContext
): ResolvedBlockNode[] {
  let changed = false;
  const out: ResolvedBlockNode[] = [];
  for (const node of nodes) {
    if (!isStarvedInstance(node)) {
      out.push(node);
      continue;
    }
    changed = true;
    const produced = expandInstance(
      node,
      ctx.run,
      ctx.hostScope,
      ctx.hostDepth + 1
    );
    for (const entry of produced) out.push(entry);
  }
  return changed ? out : (nodes as ResolvedBlockNode[]);
}

/** Whether this node is an instance left standing for want of budget. */
function isStarvedInstance(node: ResolvedBlockNode): boolean {
  return (
    isPlainRecord(node) &&
    node.type === COMPONENT_INSTANCE_TYPE &&
    node.unresolvedComponent === "budget"
  );
}

/**
 * The same question, asked of every child forest a surviving node still holds.
 *
 * A slot the instance FILLS is skipped, mirroring `copyStoredSlots`: the plan
 * replaces those children wholesale, so the clone never reaches them and
 * nothing bound for a node inside them is ever placed. Walking them anyway
 * composed content for a target the page had already replaced, which put a
 * component nobody can receive into `referenced` and its unresolvable
 * instances into `unresolved`.
 */
function composeSlotsUnder(
  node: ResolvedBlockNode,
  plan: NodePlan | undefined,
  ctx: InlineContext,
  depth: number,
  work: WorkBudget
): void {
  const slots = node.slots;
  if (!isPlainRecord(slots)) return;
  // The same `unknown` view the clone takes: a stored slot value that is not
  // an array holds no nodes to reach.
  const stored = slots as Record<string, unknown>;
  for (const name of Object.keys(stored)) {
    if (plan?.slots?.has(name) === true) continue;
    const children = ownEntry(stored, name);
    if (!Array.isArray(children)) continue;
    composeSurvivingSlots(
      children as ResolvedBlockNode[],
      ctx,
      depth + 1,
      work
    );
  }
}

/**
 * Compose this instance's OWN slot content before the definition is cloned.
 *
 * Nested content arrives composed in its component's scope and needs no pass;
 * an instance supplying nothing has no plan to walk for.
 */
function composeOwnedSlots(
  definition: ComponentDocument,
  ctx: InlineContext,
  supplied: Record<string, ResolvedBlockNode[]> | undefined,
  owned: boolean
): void {
  if (!owned || supplied === undefined) return;
  // Where this instance's refusals begin, so the retry knows which entries it
  // may reconcile and which belong to work already finished.
  const mark = ctx.run.unresolved.length;
  composeSurvivingSlots(definition.nodes, ctx, 1, { left: ctx.run.maxNodes });
  // AFTER the whole prepass, never inside it. Slots exposed on DIFFERENT
  // definition nodes release their room as the walk reaches them, so retrying
  // one node's content the moment it is composed asks again before a later
  // node has given anything back — and the declaration order still decides.
  retryStarvedPlans(ctx, mark);
}

/**
 * Whether this definition node and everything under it reaches a reader.
 *
 * ONE predicate, because two passes ask it about the same node and a
 * disagreement between them is silent: the pass that composes the page's slot
 * content would prepare a region the clone then drops, or withhold one the
 * clone then serves and leave it empty.
 *
 * An override that SHOWS the node answers the gate for it — `scopeNode`
 * removes the envelope for `plan.visible === true`, so asking
 * `isConditionGated` of the scoped copy gives the same answer this does of the
 * stored one.
 */
function survivesGating(
  node: ResolvedBlockNode,
  plan: NodePlan | undefined
): boolean {
  if (plan?.visible === false) return false;
  if (plan?.visible === true) return true;
  return !isConditionGated(node);
}

/**
 * Give back the budget for slot content that goes with a hidden target.
 *
 * Only the PLANNED content, never the definition's own children: those were
 * charged as they were cloned, and a hidden node is abandoned before its slots
 * are visited, so nothing was spent on them to return.
 *
 * What is given back is what the HOST SURVEY charged — the stored size of the
 * content, which is what `nodes` holds until something places it. Refunding a
 * composed size credited a number the survey never took, in either direction.
 */
function refundPlannedSlots(plan: NodePlan, run: ResolveRun): void {
  if (plan.slots === undefined) return;
  for (const content of plan.slots.values()) {
    run.budget += countNodes(content.nodes);
  }
}

/** A definition node under the instance's identity, with its overrides applied. */
function scopeNode(
  node: ResolvedBlockNode,
  ctx: InlineContext,
  plan: NodePlan | undefined
): ResolvedBlockNode {
  const scoped: ResolvedBlockNode = {
    ...node,
    id: mintScopedId(ctx.run, ctx.scopeKey, node.id),
    instanceOf: ctx.owner,
  };
  // Removing the envelope rather than emptying it: `conditions` is only half of
  // what gates a node, and an instance saying "show this" means the reader
  // should stop asking.
  if (plan?.visible === true) delete scoped.visibility;
  if (plan !== undefined && plan.props.length > 0) {
    scoped.props = editedProps(node.props, plan.props);
  }
  applyScopedDomIds(scoped, ctx);
  return scoped;
}

/**
 * Give this copy of the definition its own DOM ids.
 *
 * One definition inlined into two instances publishes its `cssId` and its
 * `id` attribute twice, which is a duplicate HTML id — so an anchor, a
 * `<label for>` or an id selector reaches whichever instance the browser
 * happens to find first. Node ids are already scoped; these are the other
 * addresses a document carries and they were being spread through untouched.
 *
 * `mintDomId` rather than a rule of its own: pattern insert solves exactly
 * this when it copies a subtree, a page may hold the output of both, and two
 * spellings of one replacement would put two ids on one target.
 */
function applyScopedDomIds(
  scoped: ResolvedBlockNode,
  ctx: InlineContext
): void {
  const remap = (value: string): string => {
    const existing = ctx.domIds.get(value);
    if (existing !== undefined) return existing;
    const minted = claimDomId(ctx.run, mintDomId(value, scoped.id));
    ctx.domIds.set(value, minted);
    return minted;
  };

  if (typeof scoped.cssId === "string" && scoped.cssId !== "") {
    scoped.cssId = remap(scoped.cssId);
  }
  if (!isPlainRecord(scoped.attributes)) return;
  const names = boundedOwnKeys(scoped.attributes, MAX_ENVELOPE_ENTRIES);
  if (names === null) return;
  const next: Record<string, string> = {};
  for (const name of names) {
    const value = ownEntry(scoped.attributes, name);
    if (typeof value !== "string") continue;
    // Case-insensitively, because HTML attribute names are: a stored `ID` and
    // a stored `id` address the same thing to a browser, and remapping only
    // the lowercase spelling leaves the other duplicated.
    const isId = name.toLowerCase() === "id" && value !== "";
    defineEntry(next, name, isId ? remap(value) : value);
  }
  scoped.attributes = next;
}

/**
 * A node's slots, with the definition's children cloned and the instance's
 * substituted where it supplied any.
 *
 * `undefined` leaves whatever the node stored in place — which is only reached
 * for a `slots` that is not a record and that the instance did not fill, and
 * therefore holds no children to re-identify. Returning `{}` for one would
 * rewrite stored content during a render.
 */
function cloneSlots(
  node: ResolvedBlockNode,
  ctx: InlineContext,
  depth: number,
  plan: NodePlan | undefined
): Record<string, ResolvedBlockNode[]> | null | undefined {
  const stored = node.slots;
  const planned = plan?.slots;
  const readable = isPlainRecord(stored);
  if (!readable && planned === undefined) return undefined;

  const next: Record<string, ResolvedBlockNode[]> = {};
  if (readable && !copyStoredSlots(stored, next, ctx, depth, planned)) {
    return null;
  }
  if (planned !== undefined) fillPlannedSlots(next, planned, ctx);
  return next;
}

/** Copy each stored slot, cloning its children unless the instance replaced them. */
function copyStoredSlots(
  stored: Record<string, ResolvedBlockNode[]>,
  into: Record<string, ResolvedBlockNode[]>,
  ctx: InlineContext,
  depth: number,
  planned: ReadonlyMap<string, PlannedSlot> | undefined
): boolean {
  // Same `unknown` view as `inlineHostSlots`, for the same reason: a stored
  // slot value that is not an array travels through untouched.
  const source = stored as Record<string, unknown>;
  const target = into as Record<string, unknown>;
  for (const name of Object.keys(source)) {
    const supplied = planned?.get(name);
    if (supplied !== undefined) {
      defineEntry(target, name, placedContent(supplied, ctx));
      continue;
    }
    const children = ownEntry(source, name);
    if (!Array.isArray(children)) {
      defineEntry(target, name, children);
      continue;
    }
    const cloned = cloneDefinitionForest(children, ctx, depth + 1);
    if (cloned === null) return false;
    defineEntry(target, name, cloned);
  }
  return true;
}

/**
 * Add instance content for a slot the definition node did not store.
 *
 * A container declares its slots in its block definition; an EMPTY one is
 * absent from the stored node. Without this, filling the one slot a component
 * exposes would do nothing for every definition whose author left it empty —
 * which is the ordinary case, since a slot exists to be filled.
 */
function fillPlannedSlots(
  into: Record<string, ResolvedBlockNode[]>,
  planned: ReadonlyMap<string, PlannedSlot>,
  ctx: InlineContext
): void {
  for (const [name, content] of planned) {
    if (Object.prototype.hasOwnProperty.call(into, name)) continue;
    defineEntry(into, name, placedContent(content, ctx));
  }
}

/**
 * One planned slot's nodes, composed if this is the first time they are placed.
 *
 * The single place either kind of planned content becomes output, so the
 * "compose the page's content, leave a nested component's alone" rule is
 * stated once. Reached only from a node that survived, which is what makes
 * discarded content cost nothing.
 */
function placedContent(
  content: PlannedSlot,
  ctx: InlineContext
): ResolvedBlockNode[] {
  if (content.composed) return content.nodes;
  const composed = inlineForest(
    content.nodes,
    ctx.run,
    ctx.hostScope,
    ctx.hostDepth + 1
  );
  // Held, so a definition placing one slot's content into two of its own slots
  // composes it once and mints one set of ids rather than two.
  content.nodes = composed;
  content.composed = true;
  return composed;
}

/**
 * Take a minted DOM id, or the first spelling of it nothing else is using.
 *
 * `mintDomId` is unique within the subtree it copies and says so; the host is
 * outside that subtree, and so is every other instance on the page. Without
 * this the remapping removes one class of duplicate id and leaves another.
 *
 * Deterministic: the same page and definitions mint in the same order, so the
 * same suffix lands on the same node on every render.
 */
function claimDomId(run: ResolveRun, base: string): string {
  if (!run.takenDomIds.has(base)) return heldDomId(run, base);
  // Terminates: the set is finite and the suffix strictly increases.
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!run.takenDomIds.has(candidate)) return heldDomId(run, candidate);
  }
}

/** Take a DOM id, recording it so a refused expansion can give it back. */
function heldDomId(run: ResolveRun, id: string): string {
  run.takenDomIds.add(id);
  run.mintedDomIds.push(id);
  return id;
}

/**
 * The id one definition node wears inside one instance.
 *
 * A DIGEST of the pair, not the pair itself. Figma addresses an instance's
 * children by the concatenated path, chained once per level, which is
 * collision-free by construction and readable — and grows by a whole id per
 * level of nesting. These ids reach the DOM, the stylesheet and every React
 * key, so at five levels over a large page the paths would outweigh the content
 * they identify. A digest is the same width at every depth.
 *
 * The cost of a digest is that it can collide, so it is disambiguated against
 * every id already in use, the host document's own included. Deterministic: the
 * same document and definitions produce the same ids in the same order on every
 * render, which is the property the whole composition depends on.
 */
function mintScopedId(
  run: ResolveRun,
  instanceId: string,
  definitionNodeId: string
): string {
  const base = `${SCOPED_ID_PREFIX}${hashId(`${instanceId} ${definitionNodeId}`)}`;
  if (!run.taken.has(base)) {
    run.taken.add(base);
    run.minted.push(base);
    return base;
  }
  // Terminates: `taken` is finite and the suffix strictly increases.
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (run.taken.has(candidate)) continue;
    run.taken.add(candidate);
    run.minted.push(candidate);
    return candidate;
  }
}

// ---------------------------------------------------------------------------
// Writing an override into a node's props
// ---------------------------------------------------------------------------

/** A node's props with every planned edit applied, leaving the original alone. */
function editedProps(
  props: unknown,
  edits: readonly PropEdit[]
): Record<string, unknown> {
  const next: Record<string, unknown> = isPlainRecord(props)
    ? { ...props }
    : {};
  for (const edit of edits) writeEdit(next, edit);
  return next;
}

/**
 * Apply one edit at its dot path, copying each record on the way down.
 *
 * Copied rather than mutated because the definition is shared: two instances of
 * one component are handed the same stored object, and writing through it would
 * make the first instance's overrides appear inside the second.
 *
 * Written with `defineEntry`/`ownEntry` throughout. The path segments come from
 * a stored definition, and `props.__proto__ = value` sets a prototype instead
 * of a property while `props.constructor` reads a function from a record that
 * never had the key.
 */
function writeEdit(root: Record<string, unknown>, edit: PropEdit): void {
  const segments = edit.path.split(".");
  let target = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const next = descend(target, segments[i], edit.unset);
    if (next === undefined) return;
    target = next;
  }
  const last = segments[segments.length - 1];
  if (!edit.unset) {
    defineEntry(target, last, edit.value);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(target, last)) delete target[last];
}

/**
 * The record one path segment leads to, copied so the original is untouched.
 *
 * `undefined` stops the write. Clearing a path that does not exist is already
 * cleared, and building the records to reach it would ADD the structure the
 * author asked to remove.
 */
function descend(
  target: Record<string, unknown>,
  key: string,
  unset: boolean
): Record<string, unknown> | undefined {
  const existing = ownEntry(target, key);
  if (isPlainRecord(existing)) {
    const copy = { ...existing };
    defineEntry(target, key, copy);
    return copy;
  }
  if (unset) return undefined;
  const created: Record<string, unknown> = {};
  defineEntry(target, key, created);
  return created;
}

/** Whether a stored `propPath` is one this will follow. */
function isUsablePropPath(path: string): boolean {
  if (path === "") return false;
  const segments = path.split(".");
  if (segments.length > MAX_PROP_PATH_SEGMENTS) return false;
  return segments.every(segment => segment !== "");
}
