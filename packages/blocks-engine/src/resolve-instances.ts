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
  isUnsetOverride,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type OverrideValue,
} from "./document";
import { walkForest } from "./forest-walk";
import {
  DEFAULT_LIMITS,
  MAX_COMPOSED_DEPTH,
  MAX_ENVELOPE_ENTRIES,
  type DocumentLimits,
} from "./limits";
import { isPlainRecord } from "./plain-record";
import { defineEntry, ownEntry } from "./safe-record";
import { hashId } from "./style/node-class";

/**
 * Why an instance was left standing instead of being replaced by its
 * definition's tree.
 *
 * A closed list rather than a message, because each reason has a different
 * remedy and the surface showing it has to pick one: `missing` asks the author
 * to publish or restore a component, `cycle` asks them to break a containment
 * loop, `depth` and `budget` are limits, and `malformed` is a document fault
 * no author action fixes. A rendered string would carry the same information
 * in a form nothing can branch on and nothing can translate.
 */
export const COMPONENT_UNRESOLVED_REASONS = [
  /** No definition was supplied for the referenced id. */
  "missing",
  /** The component reaches itself through its own tree. */
  "cycle",
  /** Nesting passed `MAX_COMPOSED_DEPTH`. */
  "depth",
  /** Inlining it would pass the run's node budget. */
  "budget",
  /** The instance node does not name a component id. */
  "malformed",
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
   * The component instance this node was inlined for.
   *
   * Set on every node that came from a definition, never on one an author
   * placed. It is the discrimination the editor cannot make any other way: an
   * instance's slot content is nested INSIDE the inlined tree and is the
   * page's own, so "sits under an inlined root" answers "is this editable?"
   * wrongly for exactly the nodes a marketer is there to edit.
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
  definitions: DefinitionsById,
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
  // Identity for an ordinary page is guaranteed twice over — `inlineForest`
  // returns its input array when nothing changed — so this is not what makes
  // the common case allocation-free. What it decides is the case the survey
  // could NOT read: a document already past `maxNodes` is composed not at all
  // rather than up to the cap, because a partial composition mints ids that
  // stay stable only until someone raises the limit.
  if (!survey.hasInstance) return unchanged;

  const run: ResolveRun = {
    definitions,
    maxDepth: limits.maxDepth,
    maxComposedDepth: options.maxComposedDepth ?? MAX_COMPOSED_DEPTH,
    budget: limits.maxNodes,
    taken: survey.ids,
    referenced: [],
    referencedSeen: new Set<string>(),
    unresolved: [],
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
  definitions: DefinitionsById;
  maxDepth: number;
  maxComposedDepth: number;
  /** Nodes this resolution may still produce, across every instance. */
  budget: number;
  /** Every id in use, so a minted one cannot shadow a stored node. */
  taken: Set<string>;
  referenced: string[];
  referencedSeen: Set<string>;
  unresolved: UnresolvedInstance[];
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
  ids: Set<string>;
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
  let hasInstance = false;
  let budget = maxNodes;
  walkForest(nodes, entry => {
    if (budget <= 0) return "stop";
    budget -= 1;
    const node = entry.node;
    if (!isPlainRecord(node)) return "descend";
    if (typeof node.id === "string") ids.add(node.id);
    if (node.type === COMPONENT_INSTANCE_TYPE) hasInstance = true;
    return "descend";
  });
  return { hasInstance, ids };
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
  depth: number
): ResolvedBlockNode[] {
  const componentId = componentIdOf(instance);
  if (componentId === undefined) {
    return [refuse(run, instance, "", "malformed")];
  }
  noteReference(run, componentId);

  const reason = refusalFor(componentId, run, scope);
  if (reason !== undefined) {
    return [refuse(run, instance, componentId, reason)];
  }

  // Established by `refusalFor`, which is the only reader that can tell a
  // missing definition from an unreadable one.
  const definition = run.definitions.get(componentId) as ComponentDocument;
  const supplied = suppliedSlots(instance, run, scope, depth);
  const ctx: InlineContext = {
    run,
    instanceId: instance.id,
    plans: planEdits(definition, instance, supplied),
    scope: {
      depth: scope.depth + 1,
      onPath: new Set(scope.onPath).add(componentId),
    },
  };

  const before = run.budget;
  const inlined = cloneDefinitionForest(definition.nodes, ctx, 1);
  if (inlined === null) {
    // Restored so the page's remaining instances are judged against the budget
    // this one did not spend. A partially inlined component is not a component.
    run.budget = before;
    return [refuse(run, instance, componentId, "budget")];
  }
  return inlined;
}

/** Why this instance cannot be inlined here, if it cannot. */
function refusalFor(
  componentId: string,
  run: ResolveRun,
  scope: ComposedScope
): ComponentUnresolvedReason | undefined {
  if (scope.onPath.has(componentId)) return "cycle";
  if (scope.depth >= run.maxComposedDepth) return "depth";
  const definition = run.definitions.get(componentId);
  if (!isPlainRecord(definition) || !Array.isArray(definition.nodes)) {
    return "missing";
  }
  return undefined;
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
 * The instance's own slot content, resolved in the scope it was AUTHORED in.
 *
 * Resolved before the definition is inlined and in the OUTER scope, because
 * this content belongs to the page rather than to the component: a component
 * nested in it is nested in the page, not one level further into the
 * composition, and re-identifying it would move page nodes to ids the editor
 * cannot address.
 */
function suppliedSlots(
  instance: ResolvedBlockNode,
  run: ResolveRun,
  scope: ComposedScope,
  depth: number
): Record<string, ResolvedBlockNode[]> | undefined {
  const slots = instance.slots;
  if (!isPlainRecord(slots)) return undefined;
  return inlineHostSlots(slots, run, scope, depth);
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
  slots?: Map<string, ResolvedBlockNode[]>;
}

/** What each of the definition's nodes gets, keyed by its id in the definition. */
function planEdits(
  definition: ComponentDocument,
  instance: ResolvedBlockNode,
  supplied: Record<string, ResolvedBlockNode[]> | undefined
): Map<string, NodePlan> {
  const plans = new Map<string, NodePlan>();
  const values = effectiveOverrides(definition, instance);
  if (values.size > 0) planExposed(definition.exposed, values, plans);
  if (supplied !== undefined) planSlots(definition.slots, supplied, plans);
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
  let budget = MAX_ENVELOPE_ENTRIES;
  for (const key of Object.keys(source)) {
    if (budget <= 0) return;
    budget -= 1;
    into.set(key, ownEntry(source, key));
  }
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
  plans: Map<string, NodePlan>
): void {
  if (!isPlainRecord(slots)) return;
  let budget = MAX_ENVELOPE_ENTRIES;
  for (const id of Object.keys(slots)) {
    if (budget <= 0) return;
    budget -= 1;
    const content = ownEntry(supplied, id);
    const target = slotTarget(ownEntry(slots, id));
    if (!Array.isArray(content) || target === undefined) continue;
    const plan = planFor(plans, target.nodeId);
    const into = plan.slots ?? new Map<string, ResolvedBlockNode[]>();
    plan.slots = into;
    into.set(target.slot, content);
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
  /** The id every node produced here is scoped to and marked with. */
  instanceId: string;
  plans: ReadonlyMap<string, NodePlan>;
  /** The scope INSIDE this component, for instances the definition itself holds. */
  scope: ComposedScope;
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
  if (depth > ctx.run.maxDepth) return [];
  const out: ResolvedBlockNode[] = [];
  for (const node of nodes) {
    if (!isPlainRecord(node) || typeof node.id !== "string") continue;
    if (ctx.run.budget <= 0) return null;
    ctx.run.budget -= 1;
    const produced = cloneDefinitionNode(
      node as unknown as ResolvedBlockNode,
      ctx,
      depth
    );
    if (produced === null) return null;
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
  if (plan?.visible === false) return [];

  const scoped = scopeNode(node, ctx, plan);
  if (scoped.type === COMPONENT_INSTANCE_TYPE) {
    return expandInstance(scoped, ctx.run, ctx.scope, depth);
  }

  const slots = cloneSlots(node, ctx, depth, plan);
  if (slots === null) return null;
  if (slots !== undefined) scoped.slots = slots;
  return [scoped];
}

/** A definition node under the instance's identity, with its overrides applied. */
function scopeNode(
  node: ResolvedBlockNode,
  ctx: InlineContext,
  plan: NodePlan | undefined
): ResolvedBlockNode {
  const scoped: ResolvedBlockNode = {
    ...node,
    id: mintScopedId(ctx.run, ctx.instanceId, node.id),
    instanceOf: ctx.instanceId,
  };
  // Removing the envelope rather than emptying it: `conditions` is only half of
  // what gates a node, and an instance saying "show this" means the reader
  // should stop asking.
  if (plan?.visible === true) delete scoped.visibility;
  if (plan !== undefined && plan.props.length > 0) {
    scoped.props = editedProps(node.props, plan.props);
  }
  return scoped;
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
  if (planned !== undefined) fillPlannedSlots(next, planned);
  return next;
}

/** Copy each stored slot, cloning its children unless the instance replaced them. */
function copyStoredSlots(
  stored: Record<string, ResolvedBlockNode[]>,
  into: Record<string, ResolvedBlockNode[]>,
  ctx: InlineContext,
  depth: number,
  planned: ReadonlyMap<string, ResolvedBlockNode[]> | undefined
): boolean {
  // Same `unknown` view as `inlineHostSlots`, for the same reason: a stored
  // slot value that is not an array travels through untouched.
  const source = stored as Record<string, unknown>;
  const target = into as Record<string, unknown>;
  for (const name of Object.keys(source)) {
    const supplied = planned?.get(name);
    if (supplied !== undefined) {
      defineEntry(target, name, supplied);
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
  planned: ReadonlyMap<string, ResolvedBlockNode[]>
): void {
  for (const [name, content] of planned) {
    if (Object.prototype.hasOwnProperty.call(into, name)) continue;
    defineEntry(into, name, content);
  }
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
    return base;
  }
  // Terminates: `taken` is finite and the suffix strictly increases.
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (run.taken.has(candidate)) continue;
    run.taken.add(candidate);
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
