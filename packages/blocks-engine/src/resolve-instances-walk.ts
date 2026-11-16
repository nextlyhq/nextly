/**
 * The recursive walk that inlines instances: the host document's forest, each
 * instance expanded into its definition, and the definition cloned with its
 * slots composed, which walks back into any instance they hold. One module,
 * because each of these calls the others.
 *
 * @module resolve-instances-walk
 */
import { COMPONENT_INSTANCE_TYPE, type ComponentDocument } from "./document";
import { isPlainRecord } from "./plain-record";
import {
  type InlineContext,
  isStarvedInstance,
  reconcileRefusals,
  refundPlannedSlots,
  scopeNode,
  survivesGating,
  type WorkBudget,
} from "./resolve-instances-clone";
import type {
  PropExposure,
  ResolvedBlockNode,
} from "./resolve-instances-contract";
import {
  chargeEntry,
  chargePrepassEntry,
  definitionFor,
  type InstancePlacement,
  noteReference,
  refuse,
  rollback,
  savepoint,
  suppliedSlots,
  withInstanceConditions,
  withInstanceDevices,
  withRemappedIdReferences,
  workSpent,
} from "./resolve-instances-expand";
import {
  type NodePlan,
  planEdits,
  planExposedProps,
  type PlannedSlot,
  relayOf,
} from "./resolve-instances-exposures";
import {
  componentIdOf,
  type ComposedScope,
  type ResolveRun,
} from "./resolve-instances-run";
import { defineEntry, ownEntry } from "./safe-record";
import { isConditionGated } from "./visibility";

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
export function inlineForest(
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
  // Stripped HERE, before the instance branch, because both kinds of node on
  // this walk are the page's own and neither may arrive already wearing this
  // pass's provenance. The instance case is the one that bites: it returns
  // below without reaching the host cleanup, and a refusal SPREADS the node it
  // was given — so a hand-edited instance whose component is missing, cyclic or
  // budget-refused kept its forged claim precisely when a placeholder is drawn
  // for it, which is the element an author can see and click.
  const own = "instanceOf" in node ? withoutInstanceOf(node) : node;
  if (own.type === COMPONENT_INSTANCE_TYPE) {
    return expandInstance(own, run, scope, depth);
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
  // A gated node is dropped with its whole subtree by `pruneHiddenNodes`, so a
  // stored claim on one reaches no reader whether or not it was cleared here.
  // Reported as unchanged rather than as a stripped node, which keeps the
  // identity signal below meaning what it says.
  if (isConditionGated(own)) return null;
  const slots = own.slots;
  if (!isPlainRecord(slots)) return own === node ? null : [own];
  const next = inlineHostSlots(slots, run, scope, depth);
  if (next === slots) return own === node ? null : [own];
  return [{ ...own, slots: next }];
}

/**
 * The same node with a stored provenance claim removed.
 *
 * `instanceOf` means "the resolver inlined this node from a definition", and
 * the only writer that may say so is this pass. Documents arrive from places
 * that never ran it — an export replayed, a tree a host assembled, content
 * hand-edited in storage — and `sanitizeDocument` preserves unknown node keys
 * deliberately, so a page node can reach the resolver already claiming to
 * belong to a component. An editor reading that marker sends a click, an edit
 * or a delete to an instance the author never placed, and the node they were
 * pointing at is one of their own.
 *
 * Cleared on the way through rather than checked at every reader: this is the
 * pass that OWNS the field, so it is the one place that can tell a stored claim
 * from provenance it created. Applied only on the page walk, which is why
 * `cloneDefinitionNode` is untouched — provenance on a definition-owned node is
 * this pass's own and must survive.
 */
function withoutInstanceOf(node: ResolvedBlockNode): ResolvedBlockNode {
  // Copied by DESCRIPTOR, so the property is removed without ever being read.
  // Destructuring and spreading both INVOKE a getter, and this runs on trees a
  // host assembled in memory rather than only on JSON from the database — so a
  // node carrying an enumerable `instanceOf` accessor that throws would take
  // the whole resolution down from here, before any per-block boundary could
  // contain it and draw a placeholder. Measured: it aborted `PageRenderer`
  // outright.
  //
  // Other properties keep whatever descriptors they had, which is deliberate:
  // this changes only when `instanceOf` is read, not how the rest of the node
  // behaves.
  const descriptors = Object.getOwnPropertyDescriptors(node);
  delete descriptors.instanceOf;
  return Object.defineProperties({}, descriptors) as ResolvedBlockNode;
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
  owner?: string,
  relay?: ReadonlyMap<string, PropExposure>
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
  if (isConditionGated(instance) && !run.carryConditions) return [instance];

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

  // Nothing is prepared for an expansion the caller's allowance can no longer
  // pay for. Picking slot content and planning an instance's edits walk the
  // definition's envelope, which the allowance does not charge, so an allowance
  // spent on an earlier sibling would otherwise let every later instance repeat
  // that preparation before its first entry was refused.
  if (workSpent(run)) return [refuse(run, instance, componentId, "budget")];

  // Taken before ANY speculative work, `suppliedSlots` included. Resolving an
  // instance's slot content spends budget and mints ids, and a refusal below
  // discards that content — `refuse` returns the instance with its STORED
  // slots — so a mark taken after it would leave a refused instance having
  // permanently charged the page for a tree nobody receives.
  const mark = savepoint(run);
  let inlined: ResolvedBlockNode[] | null;
  try {
    inlined = inlinedDefinition(instance, definition, componentId, {
      run,
      scope,
      depth,
      presupplied,
      owner,
      relay,
    });
  } catch {
    // Everything that follows CONSUMES the definition — its nodes, their props,
    // their slots — and all of it is a caller's data. A field that computes
    // itself and throws took that error out of a function promising a
    // classification and a closed list of reasons. Guarding the envelope read
    // was not enough: a NODE's fields are read later, by the clone.
    //
    // Contained at the expansion of ONE instance, which is the unit the
    // savepoint already covers, so a definition that fails halfway gives back
    // the ids and budget it had begun to claim — exactly as a refusal for the
    // node budget does. `unreadable` is the reason this module already
    // publishes for a supplied document it cannot read.
    run.abort = undefined;
    rollback(run, mark);
    // A loop closed inside it goes back as well. The renderer draws this
    // instance as an unreadable placeholder, so no reader receives the loop;
    // an expansion stopped by a limit would have drawn it, given room.
    run.loopsClosed.length = mark.loopsClosed;
    return [refuse(run, instance, componentId, "unreadable")];
  }
  if (inlined === null) {
    const reason = run.abort ?? "budget";
    run.abort = undefined;
    rollback(run, mark);
    return [refuse(run, instance, componentId, reason)];
  }
  return inlined;
}

/**
 * The definition's tree, inlined for one instance — the speculative half.
 *
 * Split from the refusal handling above so that everything which READS a
 * caller's definition sits inside one boundary, and so the savepoint that pays
 * for it is taken in exactly one place.
 */
function inlinedDefinition(
  instance: ResolvedBlockNode,
  definition: ComponentDocument,
  componentId: string,
  placement: InstancePlacement
): ResolvedBlockNode[] | null {
  const { run, scope, depth, presupplied, owner, relay } = placement;
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
  const plans = planEdits(definition, instance, supplied, !owned);
  // The host placement's own exposures, and a nested instance's only where a
  // host exposure drives them: its fields are reached through the host
  // component's, so its nodes carry the HOST exposure's id or none.
  if (run.exposures && (owner === undefined || relay !== undefined)) {
    planExposedProps(definition, instance, plans, relay);
  }
  const ctx: InlineContext = {
    run,
    scopeKey: instance.id,
    owner: owner ?? instance.id,
    domIds: new Map<string, string>(),
    plans,
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
  if (inlined === null) return null;
  return withInstanceConditions(
    withInstanceDevices(inlined, instance),
    instance
  );
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
    if (!chargeEntry(ctx.run)) {
      ctx.run.abort = "budget";
      return null;
    }
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
  if (!survivesGating(node, plan, ctx.run)) {
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
      ctx.owner,
      relayOf(plan?.exposedProps)
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
    if (!chargePrepassEntry(work, ctx.run)) return;
    if (!isPlainRecord(node) || typeof node.id !== "string") continue;
    const plan = ctx.plans.get(node.id);
    if (!survivesGating(node, plan, ctx.run)) {
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
