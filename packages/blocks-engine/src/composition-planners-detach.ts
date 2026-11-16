/**
 * Detaching a component instance: the instance's definition resolved and
 * composed into plain blocks, with the content its slots were given put back,
 * in place of the instance.
 *
 * @module composition-planners-detach
 */
import {
  removableRefusal,
  replacementPosition,
} from "./composition-planners-components";
import type {
  CompositionPlan,
  PlanProblem,
  PlanRefusal,
  PlanResult,
} from "./composition-planners-contract";
import type { RunPlacement } from "./composition-planners-patterns";
import { insertOps } from "./composition-planners-provenance";
import {
  destinationOf,
  domIdsIn,
  duplicateDomIdRefusal,
  freshCopy,
  internalNestingRefusal,
  lockRefusal,
  placementRefusal,
  shapeRefusal,
} from "./composition-planners-refusals";
import {
  type BlockDocument,
  type BlockNode,
  type Condition,
  isComponentInstance,
} from "./document";
import { DEFAULT_LIMITS, type DocumentLimits } from "./limits";
import type { NestingSource } from "./nesting";
import {
  applyOps,
  type BuilderOp,
  documentRefusal,
  forestRefusal,
} from "./ops";
import { isPlainRecord } from "./plain-record";
import {
  type ComponentUnresolvedReason,
  type DefinitionsById,
  resolveComponentInstances,
} from "./resolve-instances";
import { defineEntry, ownKeys } from "./safe-record";
import { contiguousRun } from "./sibling-run";
import { mapForest, newId, reidForestWithMap } from "./tree";
import { isConditionGated } from "./visibility";

/**
 * Detach a component instance: inline what it renders, and stop tracking it.
 *
 * The instance is replaced, where it stands, by the nodes it was drawing —
 * the definition's tree with this instance's overrides, variant and slot
 * content already applied. Afterwards the author owns those nodes outright and
 * an edit to the definition no longer reaches them, which is the whole point:
 * detach is how a page escapes a component without losing what it looked like.
 *
 * One way, and undoable only through history. Every builder that ships this
 * ships it that way — Webflow's `unlinkComponent`, Gutenberg's unsynced
 * pattern, Figma's detached instance — and the reason is that the inverse is
 * not well defined: once the nodes are edited there is no telling which of them
 * the definition would still claim.
 *
 * ## What it renders, through the renderer's own resolver
 *
 * The inlined nodes come from {@link resolveComponentInstances}, not from a
 * second traversal of the definition. Overrides, variant selection, exposed
 * slots and their defaults are a body of rules that already exists and is
 * already tested; a planner that re-applied them would agree with the page
 * until one of the two moved, and the failure would be silent — a detach that
 * produces subtly different content from what the author was looking at.
 *
 * ## Nested instances stay linked, by construction
 *
 * A component the author dropped INTO this instance's slot is their content,
 * not this component's, and detaching their host says nothing about it. That
 * rule cannot be had from the resolver's depth cap: `maxComposedDepth` bounds
 * DEFINITION-internal nesting, and supplied slot content is composed in the
 * host's own scope where the depth never advances — measured, a nested instance
 * in supplied content is fully inlined at depth 1, losing its link.
 *
 * So the content never reaches the resolver. Each supplied slot is swapped for
 * a placeholder, the definition is resolved around those, and the author's own
 * nodes are put back afterwards untouched. Nothing has to detect a nested
 * instance because nothing was ever in a position to inline one.
 *
 * ## The author's content moves; the definition's is copied
 *
 * Two different things happen to two different halves, and conflating them is
 * the defect this shape avoids. Supplied slot content MOVES: it keeps its node
 * ids and its authored DOM ids, because it is the same content in a new parent
 * and the instance that held it is removed in the same group. The definition's
 * contribution is a COPY: it takes fresh node ids, and it may keep its authored
 * DOM ids only where the page has none to collide with.
 *
 * The resolver's own ids are never persisted either way. It mints a `cx-`
 * scoped id per composed node — a render-time digest, deliberately not a stored
 * id shape — and re-minting DOM ids unconditionally is the defect
 * `planInsertPattern` was fixed for: an id renamed on a page that had no
 * conflict grows a suffix every cycle.
 */
export function planDetach(
  document: BlockDocument,
  instanceId: string,
  definitions: DefinitionsById,
  nesting: NestingSource,
  limits: DocumentLimits = DEFAULT_LIMITS
): PlanResult<never> {
  const detached = detachedPage(
    document,
    instanceId,
    definitions,
    nesting,
    limits
  );
  return detached.problem === undefined ? detached.plan : detached;
}

/** A detach plan, with the page applying it produces. */
export interface DetachedPage {
  readonly plan: CompositionPlan<never>;
  /** The page with the plan's ops applied, under the limits it was judged by. */
  readonly document: BlockDocument;
  readonly problem?: undefined;
}

/**
 * {@link planDetach}, keeping the page its limit check already applied.
 *
 * The check applies the whole op group to learn whether the page stays within
 * its limits, and that apply measures the page once per op. A caller that
 * applies the plan next takes this page instead of paying for the same apply
 * a second time; it is the document `applyOps` returns for the plan's ops.
 */
export function detachedPage(
  document: BlockDocument,
  instanceId: string,
  definitions: DefinitionsById,
  nesting: NestingSource,
  limits: DocumentLimits
): DetachedPage | PlanRefusal {
  // Everything `applyOp` asks before it looks at an op, asked exactly as the
  // other planners ask it: the envelope, then the whole forest, because a
  // malformed node the author never touched refuses the first op of a group.
  if (
    documentRefusal(document) !== undefined ||
    forestRefusal(document.nodes) !== undefined
  ) {
    return { problem: "unusable-document" };
  }

  const located = locatedInstance(document, instanceId);
  if (located.problem !== undefined) return located;

  const position = replacementPosition(located.at);
  if (position.problem !== undefined) return position;

  // The page as it will BE, taken from the op layer rather than derived: the
  // remove has to succeed for anything else to matter, and its result is also
  // the only honest answer to "which DOM ids are still taken". The instance's
  // own subtree is not among them — that content is moving, not being copied
  // beside itself, and treating it as taken renames the author's own anchors.
  const locked =
    lockRefusal(document.nodes, [located.node]) ??
    removableRefusal(document, [located.node]);
  if (locked !== undefined) return locked;

  const removal: BuilderOp = { kind: "remove", id: located.node.id };
  let remaining: BlockDocument;
  try {
    remaining = applyOps(document, [removal], limits).document;
  } catch {
    return { problem: "unusable-document" };
  }

  const inlined = detachedRoots(
    document,
    located.node,
    definitions,
    remaining.nodes,
    limits
  );
  if (inlined.problem !== undefined) return inlined;

  const destination = destinationOf(document, position.at);
  if (destination.problem !== undefined) return destination;

  // Asked of the nodes GOING IN, not of the instance they replace. A slot that
  // accepted a component instance need not accept what the component draws.
  const refusal =
    placementRefusal(inlined.roots, destination.place.where, nesting) ??
    internalNestingRefusal(inlined.roots, nesting);
  if (refusal !== undefined) return refusal;

  // Through the SHARED builder, not a second insert path. It takes the locks
  // off on the way in and puts them back once the nodes have landed, because
  // `applyOp` refuses an insert whose subtree arrives locked — the inverse of
  // an insert is a remove, and a remove refuses a locked subtree, so such an
  // insert could never be undone. A definition holding a locked block is
  // ordinary, and building the ops by hand refused every one of them, reported
  // as a byte-cap failure.
  const ops: BuilderOp[] = [
    removal,
    ...insertOps(inlined.roots, destination.place, document, position.at),
  ];

  // The byte cap, asked of the apply because the apply is the only thing that
  // can answer it: a definition larger than the instance it replaces can push a
  // page over a ceiling it was inside. Run on a copy, since `applyOps` is pure.
  let detached: BlockDocument;
  try {
    detached = applyOps(document, ops, limits).document;
  } catch {
    return { problem: "exceeds-limits" };
  }

  return { plan: { pageOps: ops, warnings: [] }, document: detached };
}

/**
 * What each way of failing to inline an instance means to whoever asked.
 *
 * A RECORD over the reason type, not a condition, so the compiler asks for an
 * answer the day a reason is added rather than letting it fall into whichever
 * branch happens to be last. Collapsing them all to `"not-a-component"` told an
 * author to publish or repair a component that was neither missing nor broken —
 * only bigger than the limits this call was given.
 *
 * `budget` and `node-depth` are the page's ceilings, and `composed-depth` is
 * the nesting one; all three are the size answer. The rest are faults in the
 * component or in the instance naming it, which is a different screen and a
 * different remedy.
 */
const DETACH_REFUSALS: Record<ComponentUnresolvedReason, PlanProblem> = {
  budget: "exceeds-limits",
  "node-depth": "exceeds-limits",
  "composed-depth": "exceeds-limits",
  missing: "not-a-component",
  unreadable: "not-a-component",
  cycle: "not-a-component",
  malformed: "invalid-source",
};

/** One instance resolved into the nodes it renders, or why it could not be. */
interface ResolvedDefinition {
  readonly nodes: BlockNode[];
  readonly renamedDomIds: ReadonlyMap<string, string>;
  readonly problem?: undefined;
  readonly permitted?: undefined;
}

/**
 * Inline ONE instance through the renderer's own resolver, and judge the result.
 *
 * Its own function so the caller stays inside the complexity the gate allows,
 * and because everything here is about getting a trustworthy forest OUT of the
 * resolver — what happens to its ids afterwards is a separate question.
 */
function resolvedDefinition(
  document: BlockDocument,
  instance: BlockNode,
  componentId: string,
  definitions: DefinitionsById,
  limits: DocumentLimits
): ResolvedDefinition | PlanRefusal {
  // The page's OWN envelope, with only this instance in it. Built from the
  // document rather than assembled, so the resolver reads the format version
  // and settings the page actually carries.
  const probe: BlockDocument = {
    ...document,
    nodes: [instance],
  };
  const resolved = resolveComponentInstances(probe, definitions, {
    maxComposedDepth: 1,
    limits,
  });
  // THIS instance left standing means there is nothing to inline: the
  // definition is missing, unpublished, or refused. Detaching to nothing would
  // delete the author's section.
  //
  // Matched on the instance, not the component. A definition that nests an
  // instance of ITSELF reports that nested one as a cycle — carrying the same
  // `componentId` — while the outer expansion succeeded, and reading the
  // component name refused a detach that had already worked. `instanceId` is
  // the node as it appears in the returned document, which for the one being
  // detached is the id it was selected by.
  const refused = resolved.unresolved.find(
    one => one.instanceId === instance.id
  );
  if (refused !== undefined)
    return { problem: DETACH_REFUSALS[refused.reason] };

  // TWO passes of the one copier, because two different things are being
  // undone and each has its own policy.
  //
  // First the resolver's own scoping. It mints a `cx-` suffixed DOM id per
  // composed node so two instances of a component do not collide on the page —
  // a render-time digest, and `resolveComponentInstances` now says what each
  // one came from. Persisting it would store a machine id where the author
  // wrote `card-anchor`, and it would go stale the moment the definition
  // renamed its own anchor.
  //
  // Then the page. With the authored ids back, `{avoid}` renames one only where
  // the page really holds that name — the rule `planInsertPattern` was fixed to
  // follow, after unconditional re-minting was found to grow a suffix on every
  // cycle. Asking both of a single policy would need a fifth `DomIdPolicy` arm;
  // asking the same published copier twice needs none.
  // Before the copy, because copying is itself a step that can fail: a stored
  // definition reaching this module from an in-process caller can hold a value
  // JSON cannot carry — a function in `props` — and `structuredClone` throws a
  // native `DataCloneError` out of a function that promises a refusal. The
  // shape rule catches the same node and turns the crash into a cause, which is
  // what `storedRefusal` does for the pattern paths.
  const inlinedNodes = withoutResolverMarkers(resolved.document.nodes);
  if (forestRefusal(inlinedNodes) !== undefined) {
    return { problem: "unusable-document" };
  }
  // The NODE contract separately, and reported as itself: a forest of plain
  // storable records is not yet a forest of nodes this engine would carry, and
  // `"invalid-node"` is what every other planner calls that — an author whose
  // definition holds a legacy node gets the same cause whichever road they took.
  const shape = shapeRefusal(inlinedNodes);
  if (shape !== undefined) return shape;
  return { nodes: inlinedNodes, renamedDomIds: resolved.renamedDomIds };
}

/** An instance found on the page, with the position it holds. */
interface LocatedInstance {
  readonly node: BlockNode;
  readonly at: RunPlacement;
  readonly problem?: undefined;
  readonly permitted?: undefined;
}

/**
 * The one instance being detached, and where it sits.
 *
 * Through {@link contiguousRun}, which is how every other planner asks a
 * document where a selection is — so the index a detach inserts at is computed
 * by the same code that computes it for a save, rather than by a second search
 * that can answer differently.
 *
 * Not through `savableRun`: that one also asks whether the selection could be
 * lifted to a document ROOT, which is a question about saving. An instance that
 * may not be a root is still perfectly detachable where it stands.
 */
function locatedInstance(
  document: BlockDocument,
  instanceId: string
): LocatedInstance | PlanRefusal {
  const result = contiguousRun(document.nodes, [instanceId]);
  if (result.run === undefined) return { problem: result.problem };
  const place = result.run.places[0];
  if (place === undefined) return { problem: "unknown" };

  const shape = shapeRefusal([place.node]);
  if (shape !== undefined) return shape;
  // A node that is not an instance has nothing to detach FROM, and inlining
  // whatever it is would replace it with itself under a provenance record that
  // is not true.
  if (!isComponentInstance(place.node)) return { problem: "not-a-component" };

  const { parentId, slot } = result.run;
  return {
    node: place.node,
    at: {
      ...(parentId === undefined ? {} : { parentId }),
      ...(slot === undefined ? {} : { slot }),
      index: place.index,
    },
  };
}

/** The nodes an instance was drawing, ready to stand on the page themselves. */
interface DetachedRoots {
  readonly roots: readonly BlockNode[];
  readonly problem?: undefined;
  readonly permitted?: undefined;
}

/**
 * Resolve one instance into the nodes it renders, keeping its slot content out.
 *
 * The supplied slots are lifted off before the resolver sees them and put back
 * after, which is what makes "a nested instance stays linked" true by
 * construction rather than by a pass that hunts for one afterwards.
 *
 * Content the resolver does NOT place is content the page does not render —
 * a slot the definition does not expose, say — and it is not carried over. The
 * page showed the author what detaching would leave them, and this produces
 * exactly that.
 */
function detachedRoots(
  document: BlockDocument,
  instance: BlockNode,
  definitions: DefinitionsById,
  remaining: readonly BlockNode[],
  limits: DocumentLimits
): DetachedRoots | PlanRefusal {
  const componentId = instance.props?.componentId;
  if (typeof componentId !== "string" || componentId === "") {
    return { problem: "invalid-source" };
  }

  // A CONDITION-GATED instance is refused by the resolver on purpose: inlining
  // it would replace it with roots that inherit no gate, and content shown to a
  // reader it was withheld from cannot be taken back. It says so by returning
  // the instance untouched — and, unlike every other refusal, WITHOUT an
  // `unresolved` entry, so a planner reading only that list saw a clean
  // resolution and planned to replace the instance with itself: an op group
  // that reported success, stayed linked to the definition, and stamped a
  // provenance record saying it had been detached.
  //
  // The gate is lifted for the resolution and put back on the roots, which
  // preserves it exactly — gating is inherited, so a gate on each root gates
  // everything beneath it. A root carrying a gate of its OWN is refused rather
  // than merged: two condition sets combine as a cross product of their groups,
  // and quietly rewriting an author's visibility rules is not something a
  // detach should do.
  //
  // The CONDITIONS only. `devices` lives in the same envelope and is explicitly
  // NOT a gate — per-breakpoint hiding is CSS on a node that is always served —
  // and the resolver already carries it onto the roots itself, under a rule
  // about which direction may propagate. Lifting the whole envelope threw that
  // merge away and then refused every responsive instance whose definition
  // styled its own breakpoints.
  const gate = conditionGate(instance);
  const held = suppliedSlots(instance);
  const inlined = resolvedDefinition(
    document,
    withoutConditions({ ...instance, slots: held.slots }),
    componentId,
    definitions,
    limits
  );
  if (inlined.problem !== undefined) return inlined;
  const { nodes: inlinedNodes, renamedDomIds } = inlined;

  const authored = reidForestWithMap(inlinedNodes, {
    restore: renamedDomIds,
  });
  // What the page will actually hold: everything outside the instance, AND the
  // supplied content resolution PLACED — restored rather than copied, so it
  // keeps the ids it already has.
  //
  // Placed, not merely supplied. Content for a slot the definition does not
  // expose is dropped by the resolver and never reaches the page, so counting
  // its ids renamed a definition's authored anchor to avoid something that will
  // not be there — breaking a fragment link or a selector for no collision.
  if (gate !== undefined && authored.nodes.some(isConditionGated)) {
    return { problem: "condition-gated" };
  }
  // The gate goes on BEFORE the ids are judged, not after. `domIdsIn` counts
  // only what RENDERS, and a condition-gated subtree renders nothing — so a
  // hidden variant's authored anchor collides with no one. Reminting it anyway
  // gave the detached copy a permanent rename for a conflict that does not
  // exist, and one that outlives the gate: remove the condition later and the
  // fragment the author wrote is still pointing at a suffixed id.
  //
  // Applying it here also means the copier's own hidden-subtree rule is the
  // thing deciding, rather than this planner reproducing it.
  const gated = authored.nodes.map(root => ({
    ...root,
    ...gatedWith(root, gate),
  }));

  // The DEFINITION's own fault, asked before the copy and reported as itself.
  // Two of its nodes rendering one id is a fault in the component, and
  // `freshCopy` below would report it as `dom-id-collision` — which names the
  // destination and sends an author to look at the page they are detaching
  // ONTO rather than at the component. Asked of the authored form, since that
  // is where two nodes sharing an id become visible: resolution had scoped them
  // to one runtime id apiece.
  const duplicated = duplicateDomIdRefusal(authored.nodes);
  if (duplicated !== undefined) return duplicated;

  // Through the CHECKED copier, not a second call to the raw one. `{avoid}`
  // mints against the ids the destination holds, but a minted `hero-<suffix>`
  // can itself land on an id the page already carries — `freshCopy` compares
  // what was minted against that set, re-mints from fresh node ids when it
  // clashes, and refuses as `dom-id-collision` rather than producing a page
  // with two of one id. It also asks `duplicateDomIdRefusal` of the copy, which
  // is the collision entirely inside the forest.
  const placed = placedContent(held, authored.nodeIds);
  const copied = freshCopy(gated, domIdsIn([...remaining, ...placed]));
  if (copied.problem !== undefined) return copied;
  const roots = restoreSuppliedSlots(
    copied.nodes,
    held.byId,
    composed(authored.nodeIds, copied.nodeIds)
  );
  // Two nodes rendering ONE id. Resolution scoped both to one runtime id, and
  // putting the authored one back gives the page a duplicate — which `applyOps`
  // does not police and strict validation, the gate this predicts, refuses. The
  // pattern paths already ask this; asking it here is what keeps a plan from
  // succeeding into a page that cannot be published.
  return {
    roots: roots.map(root => ({
      ...root,
      origin: { from: "component" as const, id: componentId },
    })),
  };
}

/**
 * Two id maps read as one, so a caller that copied twice can still say where a
 * node it started with ended up.
 */
function composed(
  first: ReadonlyMap<string, string>,
  second: ReadonlyMap<string, string>
): ReadonlyMap<string, string> {
  const through = new Map<string, string>();
  for (const [from, middle] of first) {
    const to = second.get(middle);
    if (to !== undefined) through.set(from, to);
  }
  return through;
}

/** The condition groups an instance is gated by, when it is gated at all. */
function conditionGate(instance: BlockNode): Condition[][] | undefined {
  if (!isConditionGated(instance)) return undefined;
  const envelope = instance.visibility;
  return isPlainRecord(envelope)
    ? (envelope.conditions as Condition[][] | undefined)
    : undefined;
}

/**
 * The same node with its CONDITIONS removed and the rest of its envelope kept.
 *
 * `devices` stays: it is not a gate, and the resolver merges it onto the roots
 * under a rule of its own about which direction may propagate.
 */
function withoutConditions(instance: BlockNode): BlockNode {
  const envelope = instance.visibility;
  if (!isPlainRecord(envelope)) return instance;
  const kept: Record<string, unknown> = { ...envelope };
  delete kept.conditions;
  return { ...instance, visibility: kept };
}

/**
 * A root's visibility with the instance's conditions added, keeping its own.
 *
 * MERGED rather than assigned, because the resolver may already have put device
 * flags here — overwriting the envelope would drop the per-breakpoint hiding it
 * just carried over. Only reached when no root is condition-gated, so there are
 * no conditions of its own to lose.
 */
function gatedWith(
  root: BlockNode,
  gate: Condition[][] | undefined
): { visibility?: BlockNode["visibility"] } {
  if (gate === undefined) return {};
  const envelope = isPlainRecord(root.visibility) ? root.visibility : {};
  return { visibility: { ...envelope, conditions: gate } };
}

/**
 * The supplied content resolution actually PLACED, flattened.
 *
 * Keyed on the placeholder ids the copier reports landing, so this is exactly
 * the set {@link restoreSuppliedSlots} will put back. Content for a slot the
 * definition does not expose has no entry: the resolver dropped it, it will not
 * reach the page, and counting its ids as taken renames an authored anchor to
 * avoid a collision that cannot happen.
 */
function placedContent(
  held: SuppliedSlots,
  nodeIds: ReadonlyMap<string, string>
): BlockNode[] {
  const all: BlockNode[] = [];
  for (const [placeholder, content] of held.byId) {
    if (nodeIds.has(placeholder)) all.push(...content);
  }
  return all;
}

/** The slot content an author supplied, lifted out and stood in for. */
interface SuppliedSlots {
  /** The instance's slots, each supplied one holding a single placeholder. */
  readonly slots: Record<string, BlockNode[]>;
  /** Placeholder id → the nodes it stands in for. */
  readonly byId: ReadonlyMap<string, readonly BlockNode[]>;
}

/**
 * Swap each supplied slot for a placeholder, keeping what it held.
 *
 * A placeholder rather than nothing, because WHERE the content goes is the
 * resolver's answer to give: an exposed slot names a node deep in the
 * definition's tree, and a planner that put the content back by finding that
 * node itself would be a second implementation of the mapping — one that agrees
 * until an exposed slot moves.
 *
 * An empty or unreadable slot is dropped rather than stood in for. Supplying
 * nothing is how an author asks for the definition's own default content, and a
 * placeholder there would suppress it.
 */
function suppliedSlots(instance: BlockNode): SuppliedSlots {
  const source = instance.slots;
  const byId = new Map<string, readonly BlockNode[]>();
  const slots: Record<string, BlockNode[]> = {};
  if (!isPlainRecord(source)) return { slots, byId };
  for (const name of ownKeys(source)) {
    const content: unknown = source[name];
    if (!Array.isArray(content) || content.length === 0) continue;
    const placeholder: BlockNode = {
      id: newId(),
      type: "core/box",
      version: 1,
      props: {},
    };
    byId.set(placeholder.id, content as readonly BlockNode[]);
    // `defineEntry`, never assignment. A slot literally named `__proto__` is a
    // key a stored document may carry, and `slots[name] = …` sets the object's
    // PROTOTYPE instead of creating that key — so the placeholder would never
    // be written, the resolver would place nothing, and the author's content
    // would be dropped without a word.
    //
    // No document reaches here carrying that key today: `documentRefusal`
    // rejects one, because an own `__proto__` does not survive the round trip
    // this format is stored through. That makes the guard CHEAP rather than
    // unnecessary — reachability is a property of the call graph, and the call
    // graph moves. The cost is one function call on a path that already builds
    // an object.
    defineEntry(slots, name, [placeholder]);
  }
  return { slots, byId };
}

/**
 * Put the author's own nodes back where their placeholders landed.
 *
 * Located through the id map the copier returns, not by searching for the
 * placeholder again: the copy re-identified it, and `nodeIds` is the record of
 * where every id went. A placeholder the resolver did not place has no entry
 * and its content is not carried — see {@link detachedRoots}.
 */
function restoreSuppliedSlots(
  nodes: readonly BlockNode[],
  byId: ReadonlyMap<string, readonly BlockNode[]>,
  nodeIds: ReadonlyMap<string, string>
): BlockNode[] {
  if (byId.size === 0) return [...nodes];
  const placed = new Map<string, readonly BlockNode[]>();
  for (const [original, content] of byId) {
    const landed = nodeIds.get(original);
    if (landed !== undefined) placed.set(landed, content);
  }
  return placed.size === 0 ? [...nodes] : splicedForest(nodes, placed);
}

/** One forest, with each placed id replaced by the nodes it stands in for. */
function splicedForest(
  nodes: readonly BlockNode[],
  placed: ReadonlyMap<string, readonly BlockNode[]>
): BlockNode[] {
  const out: BlockNode[] = [];
  for (const node of nodes) {
    const content = placed.get(node.id);
    if (content !== undefined) {
      out.push(...content);
      continue;
    }
    out.push(splicedNode(node, placed));
  }
  return out;
}

/** The same, one level down. Bounded by the depth the resolver already capped. */
function splicedNode(
  node: BlockNode,
  placed: ReadonlyMap<string, readonly BlockNode[]>
): BlockNode {
  const source = node.slots;
  if (!isPlainRecord(source)) return node;
  const slots: Record<string, BlockNode[]> = {};
  for (const name of ownKeys(source)) {
    const content: unknown = source[name];
    defineEntry(
      slots,
      name,
      Array.isArray(content)
        ? splicedForest(content as readonly BlockNode[], placed)
        : (content as BlockNode[])
    );
  }
  return { ...node, slots };
}

/**
 * The resolved tree with the resolver's own fields taken off.
 *
 * `instanceOf` and `unresolvedComponent` are render-time facts —
 * `ResolvedBlockNode` says so, and `BlockNode`'s key set is the stored format.
 * Persisting either would put a field into the database that no reader of a
 * stored document expects and that strict validation does not describe.
 */
function withoutResolverMarkers(nodes: readonly BlockNode[]): BlockNode[] {
  return mapForest([...nodes], node => {
    const marked = node as BlockNode & Record<string, unknown>;
    if (
      marked.instanceOf === undefined &&
      marked.unresolvedComponent === undefined
    ) {
      return node;
    }
    const copy: Record<string, unknown> = { ...marked };
    delete copy.instanceOf;
    delete copy.unresolvedComponent;
    return copy as unknown as BlockNode;
  });
}
