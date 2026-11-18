/**
 * Cloning a definition under an instance's identity, besides the walk itself:
 * the inlining context, the work budget's refusals and refunds, and the DOM
 * ids scoped to each instance.
 *
 * @module resolve-instances-clone
 */
import {
  type BlockNode,
  COMPONENT_INSTANCE_TYPE,
  renderedDomId,
} from "./document";
import { walkForest } from "./forest-walk";
import {
  countNodes,
  ForestTooLargeError,
  MAX_ENVELOPE_ENTRIES,
} from "./limits";
import { remapListBindings } from "./list-binding-refs";
import { isPlainRecord } from "./plain-record";
import {
  type ResolvedBlockNode,
  SCOPED_ID_PREFIX,
  type UnresolvedInstance,
} from "./resolve-instances-contract";
import { editedProps, type NodePlan } from "./resolve-instances-exposures";
import {
  type ComposedScope,
  type ResolveRun,
  surveyHost,
} from "./resolve-instances-run";
import { boundedOwnKeys, defineEntry, ownEntry } from "./safe-record";
import { hashId } from "./style/node-class";
import { mintDomId } from "./tree";
import { isConditionGated } from "./visibility";

// ---------------------------------------------------------------------------
// Cloning the definition under the instance's identity
// ---------------------------------------------------------------------------

/** One instance's inlining, in progress. */
export interface InlineContext {
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
   * `reidForestWithMap` keeps, for the same reason.
   */
  domIds: Map<string, string>;
  /**
   * Each definition node's id → the id it wears in this instance, recorded
   * as it is scoped. A node is scoped before what it holds, so a binding
   * naming the list around it (`list`) finds that list here and follows it
   * to its scoped id, the one the renderer records the list's entry under.
   */
  nodeIds: Map<string, string>;
  /**
   * Each scoped node's bindings the placement gave it, by prop: the page's
   * own, so a fallback naming a page id is not re-pointed at the component's.
   */
  pageBound: Map<string, ReadonlySet<string>>;
  /**
   * The expansion of the component that holds this placement, if a component
   * does: a binding its placement got from the page is the page's there too.
   */
  host?: InlineContext;
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
 * How many entries the slot prepass may still visit.
 *
 * Its own counter rather than the run's node budget, because they measure
 * different things: the run's is what the composed DOCUMENT may still hold,
 * and spending it here would refuse a page for nodes it never produced.
 * Running out is safe — the content it did not reach is composed at placement
 * as it was before, so the bound costs the ordering benefit for that content
 * and never the content itself.
 */
export interface WorkBudget {
  left: number;
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
export function reconcileRefusals(ctx: InlineContext, mark: number): void {
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

/** Whether this node is an instance left standing for want of budget. */
export function isStarvedInstance(node: ResolvedBlockNode): boolean {
  return (
    isPlainRecord(node) &&
    node.type === COMPONENT_INSTANCE_TYPE &&
    node.unresolvedComponent === "budget"
  );
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
export function survivesGating(
  node: ResolvedBlockNode,
  plan: NodePlan | undefined,
  run: ResolveRun
): boolean {
  if (plan?.visible === false) return false;
  if (plan?.visible === true) return true;
  // A resolution carrying conditions expands a gated instance at any depth,
  // as `expandInstance` does at the page's own level, and hands the gate to
  // the roots that replace it.
  if (run.carryConditions && node.type === COMPONENT_INSTANCE_TYPE) return true;
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
/**
 * What a subtree is worth as a REFUND, or nothing when it cannot be counted.
 *
 * `countNodes` refuses a forest whose entries outrun the machine bound rather
 * than answering from a partial walk, and a refund is the wrong place to let
 * that escape. This module's whole limit strategy is to degrade — a document
 * past its budget comes back unchanged or with instances left unresolved, so a
 * visitor gets the page rather than a blank screen — and an exception thrown
 * midway through composition replaces that with nothing at all.
 *
 * Nothing is the conservative refund. It leaves the run believing it has spent
 * more than it has, so the budget it already checks runs out and the existing
 * graceful path takes over, which is the same outcome by the intended route.
 */
export function refundableCount(nodes: BlockNode[]): number {
  try {
    return countNodes(nodes);
  } catch (error) {
    if (error instanceof ForestTooLargeError) return 0;
    throw error;
  }
}

export function refundPlannedSlots(plan: NodePlan, run: ResolveRun): void {
  if (plan.slots === undefined) return;
  for (const content of plan.slots.values()) {
    run.budget += refundableCount(content.nodes);
  }
}

/** A definition node under the instance's identity, with its overrides applied. */
export function scopeNode(
  node: ResolvedBlockNode,
  ctx: InlineContext,
  plan: NodePlan | undefined
): ResolvedBlockNode {
  const scoped: ResolvedBlockNode = {
    ...node,
    id: mintScopedId(ctx.run, ctx.scopeKey, node.id),
    instanceOf: ctx.owner,
  };
  ctx.nodeIds.set(node.id, scoped.id);
  // A binding naming a list of this definition reads that list under its
  // scoped id; one naming a list around the instance is left as it is.
  if (node.bindings !== undefined) {
    scoped.bindings = remapListBindings(
      node.bindings,
      ctx.nodeIds
    ) as ResolvedBlockNode["bindings"];
  }
  // The placement's bound settings, after the remap: a list they name is one
  // around the placement, on the page, and is read under its own id.
  if (plan?.bindings !== undefined) {
    scoped.bindings = {
      ...scoped.bindings,
      ...plan.bindings,
    } as ResolvedBlockNode["bindings"];
    notePageBound(ctx, scoped.id, plan);
  }
  // Removing the envelope rather than emptying it: `conditions` is only half of
  // what gates a node, and an instance saying "show this" means the reader
  // should stop asking.
  if (plan?.visible === true) delete scoped.visibility;
  if (plan !== undefined && plan.props.length > 0) {
    scoped.props = editedProps(node.props, plan.props);
  }
  // Only this pass may say which exposure feeds a node, as with `instanceOf`:
  // a map stored on a definition's node is dropped, and the one planned for
  // this placement, if any, put in its place.
  delete scoped.exposedProps;
  if (plan?.exposedProps !== undefined) {
    scoped.exposedProps = plan.exposedProps;
  }
  applyScopedDomIds(scoped, ctx);
  return scoped;
}

/**
 * Give this copy of the definition its own DOM ids.
 *
 * One definition inlined into two instances publishes its `cssId` and its `id`
 * attribute twice, which is a duplicate HTML id — so an anchor, a `<label for>`
 * or an id selector reaches whichever instance the browser happens to find
 * first. Node ids are already scoped; these are the other addresses a document
 * carries and they were being spread through untouched.
 *
 * `mintDomId` rather than a rule of its own: pattern insert solves exactly this
 * when it copies a subtree, a page may hold the output of both, and two
 * spellings of one replacement would put two ids on one target.
 */
function applyScopedDomIds(
  scoped: ResolvedBlockNode,
  ctx: InlineContext
): void {
  // The bag is measured BEFORE the rendered id is asked for, and the answer is
  // asked of what this can actually rewrite.
  //
  // `renderedDomId` mirrors the renderer, so it accepts shapes the rewrite
  // below refuses — a custom prototype, or a bag past the envelope cap — and it
  // reads every key to do so. Asking it first therefore did two wrong things at
  // once on a malformed definition: it published a mapping for an id that then
  // STAYED on the element, retargeting every reference to an id nothing
  // renders; and it did that reading unbounded, once per instance, defeating
  // the cap this walk is otherwise held to.
  //
  // Handing it the bag only when the bag is usable makes the two agree. A
  // string `cssId` shadows the bag anyway, so a node with one still gets its
  // rendered id and its scoped replacement; only a node relying on an
  // unreadable bag now scopes nothing, which is the honest answer for an
  // address this cannot rewrite.
  const bag = snapshotAttributes(scoped.attributes);
  const rendered = renderedDomId({
    cssId: scoped.cssId,
    attributes: bag ?? undefined,
  });
  const minted =
    rendered === undefined ? undefined : scopedDomId(rendered, scoped.id, ctx);

  // Only when it is a string is `cssId` the id this node renders, which is
  // exactly when `renderedDomId` answered with it.
  if (minted !== undefined && typeof scoped.cssId === "string") {
    scoped.cssId = minted;
  }
  if (bag === null) return;
  scoped.attributes = attributesWithScopedId(bag, rendered, minted);
}

/**
 * The attribute bag as DATA: bounded, own string entries, read exactly once.
 *
 * A bag is a stored record in the ordinary case and an arbitrary object in the
 * hostile one, where a value can be a getter or a Proxy trap that answers
 * differently each time it is asked. Deriving the rendered id from one reading
 * and rewriting from a second let the two disagree: the id `hero` was published
 * to the reference table while `other` stayed on the element, so every
 * `aria-describedby="hero"` was retargeted at an id nothing renders — the same
 * failure this module set out to close, by a route that survives a bag whose
 * prototype is exactly `Object.prototype`.
 *
 * So the bag is read once, into a plain record, and both answers come from that
 * snapshot. `null` for a bag this cannot use at all — not a plain record, or
 * past the envelope cap — which is also what keeps the read bounded, since
 * {@link renderedDomId} mirrors the renderer and reads every key it is given.
 *
 * Non-string values are dropped rather than carried, matching what the rewrite
 * already emitted: the bag it produces has only ever held strings.
 */
function snapshotAttributes(
  attributes: unknown
): Record<string, string> | null {
  if (!isPlainRecord(attributes)) return null;
  const names = boundedOwnKeys(attributes, MAX_ENVELOPE_ENTRIES);
  if (names === null) return null;
  const snapshot: Record<string, string> = {};
  for (const name of names) {
    const value = ownEntry(attributes, name);
    if (typeof value === "string") defineEntry(snapshot, name, value);
  }
  return snapshot;
}

/**
 * The per-instance replacement for one of a definition's DOM ids.
 *
 * Memoized on the ORIGINAL value, so a definition spelling one id on two nodes
 * still addresses one target after composition — and so the reference pass
 * downstream can look up what a given id became.
 */
function scopedDomId(
  value: string,
  nodeId: string,
  ctx: InlineContext
): string {
  const existing = ctx.domIds.get(value);
  if (existing !== undefined) return existing;
  const minted = claimDomId(ctx.run, mintDomId(value, nodeId));
  ctx.domIds.set(value, minted);
  ctx.run.renamedDomIds.set(minted, value);
  return minted;
}

/**
 * The attribute bag with the RENDERED id replaced.
 *
 * Takes the SNAPSHOT its caller already read, never the stored bag: two
 * readings of one record can disagree, and the rendered id was derived from the
 * first — see {@link snapshotAttributes}.
 *
 * A SHADOWED id is left verbatim. It puts nothing on the page, so it cannot
 * collide with another instance of the same definition, and it is a value the
 * definition may still reference: a `hero` shadowed inside a definition was
 * naming an element in the HOST, where it resolved. Minting a scoped id for it
 * breaks that reference and aims it at nothing, which is strictly worse than
 * leaving it.
 *
 * A document that spells ONE id both ways is unaffected: both spellings equal
 * `rendered`, so both receive the same replacement and the copy keeps answering
 * to a single address.
 */
function attributesWithScopedId(
  snapshot: Record<string, string>,
  rendered: string | undefined,
  minted: string | undefined
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [name, value] of Object.entries(snapshot)) {
    // Case-insensitively, because HTML attribute names are: a stored `ID` and
    // a stored `id` address the same thing to a browser.
    const isRenderedId =
      minted !== undefined && name.toLowerCase() === "id" && value === rendered;
    defineEntry(next, name, isRenderedId ? minted : value);
  }
  return next;
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
  return heldDomId(run, freeDomId(base, run.takenDomIds));
}

/**
 * `base`, or the first spelling of it (`base-2`, `base-3`, ...) `taken` does
 * not hold. Deterministic, so the same claims made in the same order land on
 * the same spellings on every render.
 */
function freeDomId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  // Terminates: the set is finite and the suffix strictly increases.
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Take a minted DOM id outside a composition run: `base`, or the first
 * spelling of it nothing in `taken` uses, recorded in `taken`. The claim a
 * component's inlined nodes make (`claimDomId`), for another composition
 * drawing content into a host page, such as an entry's blocks drawn inside
 * its template, so neither ever renders an id the host already publishes.
 */
export function claimedDomId(base: string, taken: Set<string>): string {
  const id = freeDomId(base, taken);
  taken.add(id);
  return id;
}

/**
 * The node ids and DOM ids a host forest already holds, read at most
 * `maxNodes` entries deep: what a composition drawing content into it mints
 * against, read by the same walk the component resolver surveys a host by.
 */
export function hostIdsIn(
  nodes: readonly unknown[],
  maxNodes: number
): {
  readonly ids: Set<string>;
  readonly domIds: Set<string>;
  /** How many entries the walk read, at most `maxNodes`. */
  readonly count: number;
  /** Whether the forest holds more than `maxNodes` entries. */
  readonly truncated: boolean;
} {
  const { ids, domIds, count, truncated } = surveyHost(nodes, maxNodes);
  return { ids, domIds, count, truncated };
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
  const minted = composedNodeId(instanceId, definitionNodeId, run.taken);
  run.minted.push(minted);
  return minted;
}

/**
 * The id a node drawn inside another wears for one render: a digest of the
 * node it is drawn inside (`scopeId`) and its own id, disambiguated against
 * every id in `taken` and then added to it. Deterministic, so the same
 * document and sources mint the same ids in the same order on every render.
 * A component's inlined nodes are minted by it, and so are an entry's blocks
 * drawn inside its template's Entry content block, so neither can take an
 * id the document already holds.
 *
 * @experimental Settles when collection templates ship.
 */
export function composedNodeId(
  scopeId: string,
  nodeId: string,
  taken: Set<string>
): string {
  const base = `${SCOPED_ID_PREFIX}${hashId(`${scopeId} ${nodeId}`)}`;
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  // Terminates: `taken` is finite and the suffix strictly increases.
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    return candidate;
  }
}

/**
 * Record a scoped node's bindings its placement gave it as this expansion's
 * page-owned ones, and as each enclosing expansion's where the placement got
 * that binding from the page there: a page binding passed down through a
 * component inside the component stays the page's at every level, while one
 * the component itself gave its placement is the component's above it.
 */
function notePageBound(
  ctx: InlineContext,
  nodeId: string,
  plan: NodePlan
): void {
  const props = Object.keys(plan.bindings ?? {});
  ctx.pageBound.set(nodeId, new Set(props));
  const keys = plan.bindingKeys ?? {};
  for (let host = ctx.host; host !== undefined; host = host.host) {
    const given = host.pageBound.get(ctx.scopeKey);
    const owned = props.filter(prop => {
      const key = ownEntry(keys, prop);
      return typeof key === "string" && given?.has(key) === true;
    });
    if (owned.length === 0) continue;
    host.pageBound.set(
      nodeId,
      new Set([...(host.pageBound.get(nodeId) ?? []), ...owned])
    );
  }
}
