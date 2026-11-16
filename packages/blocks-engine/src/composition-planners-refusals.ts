/**
 * The checks every planner shares: whether the blocks may sit where they are
 * put, the nesting verdict inside a copied forest, the destination and its
 * layer locks, duplicated ids, fresh ids for a copy, and the anchors a copy
 * would orphan.
 *
 * @module composition-planners-refusals
 */
import type {
  InsertTarget,
  PlanRefusal,
  PlanWarning,
} from "./composition-planners-contract";
import { type BlockDocument, type BlockNode, renderedDomId } from "./document";
import { lockedAncestorOf } from "./layers-lock";
import type { DocumentSurvey } from "./measure-bytes";
import {
  type NestingSource,
  type NestingVerdict,
  type PlacementTarget,
  placementVerdict,
} from "./nesting";
import {
  lockedWithin,
  nodeShapeRefusal,
  type OpPosition,
  positionRefusal,
} from "./ops";
import { type ComponentLookup, placementTypesOf } from "./resolve-instances";
import {
  findNode,
  hiddenSubtreeNodes,
  referencedDomIds,
  reidForestWithMap,
  removeNode,
  walkNodes,
} from "./tree";

/**
 * Whether an envelope index built under these limits would MISS part of the
 * forest.
 *
 * `componentEnvelopeIssues` indexes the nodes to resolve every exposure pointer
 * against, and it builds that index under `maxNodes` — so a forest past the
 * bound is indexed only as far as the bound reaches, and a pointer at anything
 * beyond it comes back as `exposed-node-missing`. Measured, a sound pointer at
 * the third node of a three-node component under `maxNodes: 2` was reported as
 * dangling, sending the author to delete or repair an exposure that was never
 * wrong while the actual problem — the size — went unmentioned.
 *
 * Only DEPTH and COUNT, because only those two truncate the index. The byte cap
 * does not: an over-cap `options` list makes a document unstorable without
 * making its node index partial, and refusing it here would answer "your
 * exposure is too big" with a verdict about the whole document. That one stays
 * behind the envelope check, where it still reads as `invalid-exposure` — which
 * is the answer an author can act on.
 */
export function overIndexBound(survey: DocumentSurvey): boolean {
  return survey.tooDeep || survey.tooManyNodes;
}

/**
 * A root the ops are about to ADDRESS that the document holds twice.
 *
 * `update` and `remove` both address a node by id and both refuse one the
 * document holds twice, because neither could say which node was meant — and a
 * selection can be built against a document nothing validated.
 *
 * Takes the roots rather than reading the selection, because the two planners
 * address different subsets of it and the rule is about what is ADDRESSED. A
 * save-over touches only the roots whose provenance it repairs; a convert
 * removes every one of them. Asking about the whole selection would refuse a
 * save-over the apply would have accepted, on a duplicate its ops never reach.
 *
 * The destination side of the same question is {@link destinationOf}, which
 * asks it about a container.
 */
export function ambiguousRootRefusal(
  document: BlockDocument,
  roots: readonly BlockNode[]
): PlanRefusal | undefined {
  for (const root of roots) {
    if (countById(document.nodes, root.id) > 1) {
      return { problem: "duplicate-destination" };
    }
  }
  return undefined;
}

/**
 * The first block that may not sit where it is being put, phrased as a refusal.
 *
 * ONE implementation for every planner and every destination. Saving a run
 * lifts it to a document root; inserting a pattern puts it at a root or in a
 * slot — and asking the same question two ways is how the two come to disagree
 * about where a block may live. The root case is not a special case of the slot
 * case, so the target says which question to ask rather than passing an
 * optional parent that means both.
 *
 * A refusal carries `permitted` because the caller is the only place that still
 * knows which selection was refused, and a surface explaining it needs to name
 * somewhere the block CAN go — the same reason `NestingVerdict` carries it.
 */
export function placementRefusal(
  blocks: readonly BlockNode[],
  where: PlacementTarget,
  nesting: NestingSource,
  definitions?: ComponentLookup
): PlanRefusal | undefined {
  // The rule itself lives with the rest of the nesting rule, where the palette
  // and the canvas reach it too. This function is the translation from its
  // verdict into the refusal a plan carries, and nothing more.
  //
  // Each block answers with what it DRAWS ({@link placementTypesOf}), which is
  // its own type unless it is an instance and the caller supplied the lookup —
  // so the rule judges the forest the canvas will render rather than the
  // envelope the store holds.
  const verdict = placementVerdict(
    blocks.flatMap(block => placementTypesOf(block, definitions)),
    where,
    nesting
  );
  if (verdict.allowed) return undefined;
  return {
    problem: verdict.reason,
    ...(verdict.permitted === undefined
      ? {}
      : { permitted: verdict.permitted }),
  };
}

/**
 * The first placement INSIDE the copied forest that the current rules refuse.
 *
 * A pattern is stored, so its internal placements were legal when it was saved
 * and the rules can have moved since — a block that gained a `parent`
 * restriction, or a slot that narrowed what it admits. Checking only the roots
 * against the destination leaves such a pattern insertable and the page
 * unpublishable, because strict validation asks about every edge.
 */
export function internalNestingRefusal(
  roots: readonly BlockNode[],
  nesting: NestingSource,
  definitions?: ComponentLookup
): PlanRefusal | undefined {
  const verdict = internalNestingVerdict(roots, nesting, definitions);
  if (verdict.allowed) return undefined;
  return {
    problem: verdict.reason,
    ...(verdict.permitted === undefined
      ? {}
      : { permitted: verdict.permitted }),
  };
}

/**
 * Whether every edge INSIDE a forest still satisfies the nesting rule.
 *
 * A question about the forest alone: it asks nothing about where the forest is
 * going, so the answer is the same at every destination. That is what makes it
 * worth asking once rather than per placement — and what makes it a different
 * question from {@link placementVerdict}, which is entirely about the target.
 *
 * It exists as a published verdict because two roads ask it. A planner refuses
 * an insert whose internals no longer nest; a palette must not OFFER one, or
 * the author is handed a tile that accepts a click the planner then rejects.
 * The two must answer identically, which they cannot do while one of them is
 * private to this module.
 *
 * Stored patterns are why this can fail at all. A pattern is saved once and
 * inserted for as long as it exists, so a block that later declares a `parent`
 * restriction — or a slot that narrows its `allow` — invalidates edges inside
 * documents nobody has touched since.
 */
export function internalNestingVerdict(
  roots: readonly BlockNode[],
  nesting: NestingSource,
  definitions?: ComponentLookup
): NestingVerdict {
  let refusal: NestingVerdict | undefined;
  walkNodes([...roots], node => {
    if (refusal !== undefined) return;
    for (const [slot, children] of Object.entries(node.slots ?? {})) {
      // A stored forest reaches here unvalidated, so a slot may hold anything.
      if (!Array.isArray(children)) continue;
      const verdict = placementVerdict(
        children.flatMap(child => placementTypesOf(child, definitions)),
        { kind: "slot", parentType: node.type, slot },
        nesting
      );
      if (!verdict.allowed) refusal ??= verdict;
    }
  });
  return refusal ?? { allowed: true };
}

/** Where the run will sit, once the destination has been checked. */
interface Destination {
  readonly place: Placement;
  readonly problem?: undefined;
}

/**
 * The resolved destination: the position, and the parent's TYPE when there is
 * one.
 *
 * The type is carried because the nesting rule is asked about types, and
 * looking the parent up a second time to get it is the mistake this package has
 * already made once — a second lookup of one id can answer differently from the
 * first.
 */
export interface Placement {
  readonly at: OpPosition | null;
  readonly where: PlacementTarget;
}

export function destinationOf(
  document: BlockDocument,
  target: InsertTarget
): Destination | PlanRefusal {
  if (target === "document") {
    // The replacing target REMOVES every root, and a remove refuses an id the
    // document holds twice — its own and any in the subtree it takes with it.
    // So for this target the whole document has to be unambiguous, where a
    // positional insert only cares about the container it aims at.
    return firstRepeatedId(document.nodes) === undefined
      ? { place: { at: null, where: { kind: "root" } } }
      : { problem: "duplicate-destination" };
  }

  // The op layer's own rule for whether a position names anywhere, asked before
  // anything is built on it. A negative index, or a parent named without its
  // slot, is refused by `applyOp` — so a plan carrying one is a dry run that
  // disagrees with the run it predicts.
  if (positionRefusal(target) !== undefined)
    return { problem: "invalid-position" };

  if (target.parentId === undefined) {
    return { place: { at: target, where: { kind: "root" } } };
  }

  // Told apart, because the remedies are opposite. NONE means the container is
  // gone — a stale target, and the author should aim somewhere that exists.
  // MORE THAN ONE means the document is malformed, which no aiming fixes and
  // which `applyOp` refuses outright because the node would be placed in both.
  const held = countById(document.nodes, target.parentId);
  if (held === 0) return { problem: "unknown" };
  if (held > 1) return { problem: "duplicate-destination" };

  const parent = findNode(document.nodes, target.parentId);
  if (parent === undefined) return { problem: "unknown" };
  // A run put into a locked block, or into a block inside one, changes what
  // that lock protects, and the op layer refuses the insert.
  if (holdsLayersLock(document.nodes, parent)) {
    return { problem: "destination-locked" };
  }
  return {
    place: {
      at: target,
      where: { kind: "slot", parentType: parent.type, slot: target.slot },
    },
  };
}

/** Whether a block is locked in Layers, itself or by a block around it. */
function holdsLayersLock(nodes: BlockNode[], block: BlockNode): boolean {
  return (
    block.locked === true || lockedAncestorOf(nodes, block.id) !== undefined
  );
}

/** The first id this document holds twice, or `undefined`. */
function firstRepeatedId(nodes: BlockNode[]): string | undefined {
  const seen = new Set<string>();
  let repeated: string | undefined;
  walkNodes(nodes, node => {
    if (repeated !== undefined) return;
    if (seen.has(node.id)) repeated = node.id;
    else seen.add(node.id);
  });
  return repeated;
}

/** How many nodes in a forest carry one id. */
export function countById(nodes: BlockNode[], id: string): number {
  let seen = 0;
  walkNodes(nodes, node => {
    if (node.id === id) seen += 1;
  });
  return seen;
}

/** The first root the op layer would refuse to carry, phrased as a refusal. */
export function shapeRefusal(
  roots: readonly BlockNode[]
): PlanRefusal | undefined {
  for (const root of roots) {
    if (nodeShapeRefusal(root) !== undefined)
      return { problem: "invalid-node" };
  }
  return undefined;
}

/**
 * A DOM id the copy uses twice, phrased as a refusal.
 *
 * Re-identifying does not fix this and is not meant to. A subtree that already
 * spelled one id on two nodes is malformed, and `reidForestWithMap` maps both
 * occurrences to ONE replacement deliberately — the pair addressed one target
 * before and still addresses one after, which is the honest reading of a
 * document that should not have existed. What that preserves is the duplicate:
 * the copy carries it into the page, where an anchor resolves to whichever
 * element the browser reaches first and a label names the wrong control.
 *
 * So a stored pattern this broken is refused rather than placed. Folded the way
 * HTML folds attribute names, and the way validation reports `duplicate-dom-id`
 * for the same shape.
 */
export function duplicateDomIdRefusal(
  roots: readonly BlockNode[]
): PlanRefusal | undefined {
  const seen = new Set<string>();
  let repeated = false;
  // Through the walk that answers what actually reaches the page, so this and
  // the destination scan cannot come to disagree about what an id in use is.
  walkRenderedIds(roots, id => {
    if (seen.has(id)) repeated = true;
    seen.add(id);
  });
  return repeated ? { problem: "duplicate-dom-id" } : undefined;
}

/**
 * A locked node the replacing target would DELETE, phrased as a refusal.
 *
 * Only the destination side asks this now. A lock on the incoming pattern is
 * carried across the insert as an update rather than refused — see
 * `insertOps` — but a lock on the page is content an author protected,
 * and a remove refuses it for a reason no re-ordering of the group can satisfy.
 */
export function lockRefusal(
  nodes: BlockNode[],
  roots: readonly BlockNode[]
): PlanRefusal | undefined {
  for (const root of roots) {
    // Inside the run, and around it: taking a block out of a locked one
    // changes what that lock protects as surely as deleting a locked block,
    // and the op layer refuses both.
    if (
      lockedWithin(root) !== undefined ||
      lockedAncestorOf(nodes, root.id) !== undefined
    ) {
      return { problem: "destination-locked" };
    }
  }
  return undefined;
}

/** A re-identified copy, or the reason one could not be made. */
interface FreshCopy {
  /**
   * Each DOM id the copy had to change, as the source spells it → as the copy
   * does. Empty when the destination held none of them.
   */
  readonly renamed: ReadonlyMap<string, string>;
  readonly nodes: BlockNode[];
  /**
   * Each node's id BEFORE the copy → the id it was given.
   *
   * Published because a caller may have put something into the forest it needs
   * to find again afterwards — detaching stands a placeholder in for the
   * author's slot content and has to know where it landed — and the copy is the
   * only thing that knows.
   */
  readonly nodeIds: ReadonlyMap<string, string>;
  readonly problem?: undefined;
}

/**
 * How many times a fresh set of ids may be minted before giving up.
 *
 * The copier is TOLD what the destination holds — that is what
 * `DomIdPolicy`'s `avoid` set is — and it mints only against that set, so
 * a collision here means a MINTED id landed on one the page already carried.
 * A minted id is derived from a fresh random node id, so that needs the exact
 * string to be there already; minting again draws different ids, so one retry
 * all but settles it and three is a bound rather than an expectation.
 *
 * Checked rather than assumed because the alternative is the failure this
 * module keeps finding: two elements sharing a DOM id, an anchor resolving to
 * whichever the browser reaches first, and nothing on screen saying so.
 *
 * NOT covered by a test, and deliberately so. The suffix comes from a freshly
 * minted UUID, so no test can arrange for the destination to already hold the
 * string that is about to be drawn — an assertion about the refusal, or about
 * which spellings {@link domIdsIn} collects, is one that cannot fail whatever
 * this code does. I wrote such a test first and deleted it: a green that no
 * implementation can turn red is not coverage, and leaving it in would have
 * made this look guarded when only the reasoning guards it.
 *
 * The same is true of the copy's INTERNAL clash, which the retry now also
 * asks about. Under `avoid` a copy keeps the ids its destination does not
 * hold, so a minted `hero-<suffix>` can land on a `hero-<suffix>` the pattern
 * itself carried and this kept — a collision the destination cannot see. It
 * needs the drawn suffix to equal a string already in the pattern, so it is
 * unreachable in a test for the reason above and it is checked for the reason
 * above: this branch could not arise at all while every id was minted, and it
 * arrived with the policy that stopped minting them.
 *
 * The property that IS covered, deterministically, is the one that matters in
 * practice: inserting one pattern twice into one page and finding no repeated
 * DOM id anywhere in the result.
 */
const MAX_ID_MINTING_ATTEMPTS = 3;

export function freshCopy(
  roots: BlockNode[],
  taken: ReadonlySet<string>
): FreshCopy | PlanRefusal {
  for (let attempt = 0; attempt < MAX_ID_MINTING_ATTEMPTS; attempt += 1) {
    const minted = reidForestWithMap(roots, { avoid: taken });
    // The whole COPY, not only the ids it minted. Under `avoid` the copy keeps
    // the ids the destination does not hold, so a minted `hero-<suffix>` can
    // land on a `hero-<suffix>` the pattern already carried and this kept — a
    // collision entirely inside the copy, which comparing against the
    // destination cannot see. It could not arise while every id was minted.
    const clash =
      [...minted.domIds.values()].some(id => taken.has(id)) ||
      duplicateDomIdRefusal(minted.nodes) !== undefined;
    if (!clash) {
      return {
        nodes: minted.nodes,
        renamed: minted.domIds,
        nodeIds: minted.nodeIds,
      };
    }
  }
  return { problem: "dom-id-collision" };
}

/**
 * The DOM ids the insert has to steer around.
 *
 * EMPTY for the `"document"` target, and that is the point rather than an
 * oversight: that target REMOVES every root before it inserts, so the ids on
 * the page are not ids the copy will land among. Passing them would mint
 * against content that is about to be deleted — and the `"document"` target is
 * "start from a pattern" on an empty document, the one flow where an author is
 * most likely to have named things and least likely to expect them renamed.
 */
export function takenDomIds(
  document: BlockDocument,
  target: InsertTarget
): ReadonlySet<string> {
  return target === "document" ? new Set<string>() : domIdsIn(document.nodes);
}

/**
 * Every DOM id the destination actually RENDERS.
 *
 * Not every id it stores, and there are two ways a stored id does not reach the
 * page. A node carrying `cssId: "actual"` beside `attributes.id: "hero"` emits
 * only `actual` — {@link renderedDomId} is the one rule for which of the two a
 * node emits, and it folds attribute names because HTML does. And a
 * CONDITION-GATED node is pruned with its whole subtree before markup, so its
 * ids reach nobody: gating exists for personalised variants of one section,
 * each carrying the same anchor with exactly one served, so counting them all
 * would rename an incoming pattern to avoid every variant of an id only one of
 * which is ever on the page.
 *
 * Both are the same mistake — treating a stored id as a rendered one — and both
 * cost the same thing: authored content renamed to avoid a collision that
 * cannot happen. `isConditionGated` is the engine's own predicate, which the
 * renderer, the style compiler and the editor's attribute panel already share;
 * a fourth reading of it would be a fourth way to disagree.
 *
 * What this cannot decide is the day an evaluator arrives and two gated nodes
 * both match. That belongs to the evaluator, not to a scan with no conditions
 * to read.
 *
 * A later edit CAN un-shadow the bag — clearing that `cssId` makes `hero`
 * render — and this cannot prevent that, any more than it can prevent an author
 * typing a duplicate afterwards. Validation reports it when it happens.
 */
export function domIdsIn(nodes: BlockNode[]): Set<string> {
  const taken = new Set<string>();
  walkRenderedIds(nodes, id => {
    taken.add(id);
  });
  return taken;
}

/**
 * Every DOM id a forest actually puts on the page, in walk order.
 *
 * ONE walk for every question about which ids are in use — which the
 * destination holds, and whether a forest spells one twice. They are the same
 * question asked of two forests, and the day they disagree is the day a save is
 * refused for a collision the insert it is refused on behalf of would not have
 * seen. That happened: the gating rule was added to one of them and not the
 * other, and it refused exactly the case gating exists for — two personalised
 * variants of a section carrying one anchor, only ever one of them served.
 *
 * Gated status is INHERITED rather than asked of each node alone, because the
 * renderer prunes a gated node's whole subtree, so an ungated child of one does
 * not render either. Carried through the shared walk, which visits a parent
 * before its children and hands the parent to each visit — a hand-rolled
 * traversal would have to re-learn what that one knows about a malformed entry
 * and a malformed slot.
 *
 * A third way a stored id fails to render is NOT excluded here: a subtree the
 * renderer replaces with a placeholder. Deciding that needs the installed
 * blocks and their versions, and a planner is handed only a nesting lookup —
 * so an id on a block the page cannot draw still counts as taken, and an
 * incoming pattern is renamed to avoid it. The cost is one renamed id on a page
 * that already contains a block it cannot draw.
 */
/**
 * The anchors a conversion would leave pointing at nothing.
 *
 * The run is about to become a component definition, and composition scopes
 * every definition-authored DOM id per instance. So an id the run RENDERS stops
 * being addressable under the name it had, and any link still on the page that
 * named it resolves to nothing.
 *
 * Asked as the difference between two forests rather than as a set subtraction
 * over one. A subtraction — everything that references the id, minus what the
 * run itself references — reports nothing for an id referenced from BOTH sides,
 * and that is the case where an outside link is still broken. So the run is
 * REMOVED and what remains is what gets asked.
 *
 * Every reader here is the engine's own: {@link domIdsIn} for what the run
 * puts on the page, `removeNode` for taking the run out of it, and
 * `referencedDomIds` for which of those ids the remainder still names — which
 * runs the relink pass with an instrumented candidate map, so what counts as a
 * reference is whatever the relink itself would follow rather than a second
 * list of attributes to keep in step.
 */
export function orphanedAnchorWarnings(
  document: BlockDocument,
  selected: readonly BlockNode[]
): PlanWarning[] {
  const owned = domIdsIn([...selected]);
  if (owned.size === 0) return [];

  // `referencedDomIds` takes the candidates as a MAP because its real caller is
  // the relink, which needs the replacement. Only the keys are consulted here,
  // so each id stands in as its own value rather than a sentinel that would
  // read as a rename to anyone tracing the call.
  const candidates = new Map<string, string>();
  for (const id of owned) candidates.set(id, id);

  let residual = [...document.nodes];
  for (const node of selected) residual = removeNode(residual, node.id);

  // Accumulated in walk order, so two runs of one plan report the same
  // warnings in the same order — a surface that lists them, or a test that
  // asserts on them, is otherwise reading an order nothing fixed.
  const roots = new Map<string, string[]>();
  referencedDomIds(residual, candidates).forEach((hits, index) => {
    const root = residual[index];
    if (root === undefined) return;
    for (const domId of hits.keys()) {
      const found = roots.get(domId);
      if (found === undefined) roots.set(domId, [root.id]);
      else found.push(root.id);
    }
  });

  return [...roots].map(([domId, referencingRoots]) => ({
    kind: "orphaned-anchor",
    domId,
    referencingRoots,
  }));
}

export function walkRenderedIds(
  nodes: readonly BlockNode[],
  fn: (id: string) => void
): void {
  const hidden = hiddenSubtreeNodes(nodes);
  walkNodes([...nodes], node => {
    if (hidden.has(node)) return;
    const id = renderedDomId(node);
    if (id !== undefined) fn(id);
  });
}
