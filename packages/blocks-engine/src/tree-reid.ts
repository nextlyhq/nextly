/**
 * Copies under fresh identities: re-identifying a subtree or a forest, the
 * DOM-id policy a copy follows and the references it relinks, the attributes
 * that name ids, the nodes a pruned subtree takes with it, and duplicating a
 * node in place.
 *
 * @module tree-reid
 */
import { type BlockNode, renderedDomId } from "./document";
import { remapFragmentBindings, remapFragmentProps } from "./fragment-refs";
import { withListsRelinked } from "./list-binding-refs";
import { isPlainRecord } from "./plain-record";
import { defineEntry, ownEntry } from "./safe-record";
import { insertNode, mapForest, newId } from "./tree-edits";
import { findNode, locateNode, walkNodes } from "./tree-walk";
import { isConditionGated } from "./visibility";

/** Deep-clone a subtree, assigning fresh ids to every node (copy/paste, patterns). */
export function reidSubtree(node: BlockNode): BlockNode {
  // Rebuilt through the shared walk rather than by recursing here. It already
  // knows how to drop a cycle-closing entry, leave a malformed slot alone and
  // keep depth off the call stack, and a second traversal written here would be
  // a second set of answers to the same three questions.
  const nodeIds = new Map<string, string>();
  const rebuilt = mapForest([node], original => {
    const copy = reidOne(original);
    if (typeof original.id === "string") nodeIds.set(original.id, copy.id);
    return copy;
  });
  // A second pass, once every id is known: a binding naming the list it reads
  // follows a list this copy re-identified to its copy, so a duplicated outer
  // list's blocks read the copy's entries rather than naming a list they are
  // no longer inside.
  const [linked] = mapForest(rebuilt, copy => withListsRelinked(copy, nodeIds));
  return linked ?? node;
}

/**
 * What a re-identification does with the DOM ids it copies.
 *
 * Two words rather than a boolean, because the call site is where this is read
 * and `true` at a call site says nothing about which way it points.
 *
 * - `{ avoid }` — mint only the ids the destination ALREADY holds, and carry
 *   the rest verbatim. For an INSERT, which is the only caller that can name
 *   what it is landing among.
 * - `"keep"` — carry every id across and record none as moved. For a run being
 *   lifted into a document of its OWN, which is every SAVE: nothing is placed
 *   beside anything, so nothing can collide.
 * - `"remint"` — mint every id unconditionally. For a copier that cannot see
 *   its destination, which is composition inlining a definition into an
 *   instance without reading the host.
 *
 * A DOM id is authored content — someone typed `hero`, and it appears in a URL
 * fragment, a stylesheet and the attribute panel — so it is rewritten only when
 * keeping it would put two elements on a page answering to one id. `{ avoid }`
 * exists because `"remint"` was doing it always: inserting into a page holding
 * no `hero` still produced `hero-e75f55fb`, and feeding that back through a
 * save grew the id by nine characters every cycle without bound.
 */
export type DomIdPolicy =
  | "remint"
  | "keep"
  | {
      /** The DOM ids the destination already carries, folded as HTML folds them. */
      readonly avoid: ReadonlySet<string>;
    }
  | {
      /**
       * DOM ids to put BACK, as they are now → as they were, keeping the rest.
       *
       * The inverse of what an `avoid` copy recorded. An insert renames an id
       * only because the page it landed on already held that name, so the new
       * one is a fact about that page rather than anything the author wrote —
       * and a copy saved back out of the page carries it into a library where
       * it means nothing, and grows another suffix on every insert-save cycle.
       *
       * A map rather than a re-mint, because the original cannot be derived
       * from the current value: a minted id is the authored one plus a suffix
       * drawn from a node id, and content from a script or an import may name
       * its anchors that way deliberately. Only the copy that did the renaming
       * knows, which is why it records it.
       */
      readonly restore: ReadonlyMap<string, string>;
    }
  | {
      /**
       * The source name for one node's DOM id, asked PER NODE — or nothing, to
       * keep the id it carries.
       *
       * For a copy whose nodes answer to different records, where one map for
       * the forest has room for one answer per id and a copy holding two nodes
       * that share an id has to put one back and leave the other. The copier
       * asks with the ORIGINAL node:
       *
       * - for the id a node RENDERS, and moves that id to the answer;
       * - for an id a node REFERENCES, and a reference takes that answer when
       *   there is one. The node holding it knows where it pointed. Only a
       *   reference its holder has no answer for follows its target: where the
       *   copied forest renders the id and the nodes settling it end up with one
       *   id, the reference takes that id; otherwise it keeps what it carries.
       *
       * Gating is not consulted, for the reason `restore` gives: putting an id
       * back asks nothing about the page.
       */
      readonly restoreEach: (
        node: BlockNode,
        value: string
      ) => string | undefined;
    };

/** Every policy but the per-node restore, which has a copier of its own. */
type SharedDomIdPolicy = Exclude<
  DomIdPolicy,
  { readonly restoreEach: unknown }
>;

/** A re-identified FOREST, and the two maps describing what moved. */
export interface ReidentifiedForest {
  /** The rebuilt roots, in the order they were given. */
  nodes: BlockNode[];
  /** Every node's old id → its new one, across every root. */
  nodeIds: ReadonlyMap<string, string>;
  /**
   * Every DOM id the forest carried → its replacement, across every root.
   *
   * EMPTY under {@link DomIdPolicy} `"keep"`, which is the honest record rather
   * than an omission: nothing moved, so nothing needs following. A caller
   * checking this map against a destination is asking which ids this copy
   * introduces, and identity entries would answer that question wrongly.
   */
  domIds: ReadonlyMap<string, string>;
}

/**
 * Deep-clone a FOREST with fresh ids, KEEPING its internal references usable.
 *
 * The same rebuild as {@link reidSubtree}, differing in what happens to a DOM
 * id: dropped there, and here either minted afresh and recorded or carried
 * across untouched, as {@link DomIdPolicy} says. Dropping is the one answer
 * neither caller can use. Two copies of one pattern on a page must not emit the
 * same HTML `id`, and a copy's internal anchor must still reach its own target
 * — and an id that is simply gone satisfies neither.
 *
 * The minted id is DERIVED from the original (`pricing` becomes
 * `pricing-<suffix>`) rather than freshly random, because it is a value authors
 * read and write: it appears in a URL fragment, in a stylesheet and in the
 * attribute panel. A UUID would be unique and unusable.
 *
 * ## Why a forest, and not one root at a time
 *
 * A saved selection is a contiguous RUN of siblings, so the document it becomes
 * holds several roots, and re-identifying them with one call each is not the
 * same operation. Each call can only see the subtree it was handed, so its
 * `domIds` records that subtree's ids and nothing else — and a reference that
 * crosses from one root to another finds no entry, and is left pointing at the
 * ORIGINAL element. For `aria-labelledby` and `aria-describedby` that means the
 * copy silently loses its accessible name, a failure invisible to everyone who
 * does not use assistive technology. Re-identifying the roots TOGETHER is what
 * makes the second pass see every id, so the guarantee is a property of this
 * function rather than of each caller remembering not to loop.
 *
 * Uniqueness is guaranteed WITHIN the returned forest, not against the document
 * it is going into — this function is given a forest and cannot see anything
 * else. A caller inserting into a page it can read should check
 * {@link ReidentifiedForest.domIds} against that page.
 *
 * ## Minting is for a copy that lands BESIDE its original
 *
 * That is the whole reason for it, so what a caller answers is which ids its
 * destination already holds. `"keep"` is for the one landing among nothing: a
 * run lifted out of a page to become a document of its OWN. `{ avoid }` is for
 * one that can name what is there. Minting where neither says to is not merely
 * unnecessary, it is wrong in three ways that were measured rather than
 * argued.
 *
 * A DOM id is authored content: someone typed `hero`, and it appears in a URL
 * fragment, a stylesheet and the attribute panel. Storing `hero-3ee4a0d4` puts
 * a value in the library that no author wrote and every author sees.
 *
 * It is not idempotent. Save the same selection twice and the two stored copies
 * differ, so anything fingerprinting content — `patternDigest` keeps `cssId`
 * deliberately, because a copy derives from it — reports a change nobody made.
 * A staleness signal that fires without cause teaches authors to dismiss the
 * one that means something.
 *
 * And it accumulates. Save, insert, save over the source, insert again: the id
 * grew by nine characters every cycle, `hero` to
 * `hero-3ee4a0d4-fb48e67c-1118df3b` and on, with no bound.
 */
/** No node is gated — the set a restore walks with. */
const EMPTY_NODE_SET: ReadonlySet<BlockNode> = new Set<BlockNode>();

export function reidForestWithMap(
  nodes: BlockNode[],
  policy: DomIdPolicy = "remint"
): ReidentifiedForest {
  if (typeof policy === "object" && "restoreEach" in policy) {
    return reidForestRestoringEach(nodes, policy.restoreEach);
  }
  const domIdPolicy: SharedDomIdPolicy = policy;
  const nodeIds = new Map<string, string>();
  const domIds = new Map<string, string>();
  const restoring = typeof domIdPolicy === "object" && "restore" in domIdPolicy;

  // A RESTORE knows both halves of every move before the walk starts, so it
  // seeds them. The other policies discover what moved as they go, and an id
  // that was not minted contributes no entry — but a restore is undoing an
  // insert's renames, and a selection may hold the REFERENCE without the node
  // that renders it. Saving only the root carrying `aria-describedby` found
  // nothing in the map, left the page-specific id in place, and put a pattern
  // in the library naming an id that exists on exactly one page.
  if (restoring) {
    for (const [now, was] of domIdPolicy.restore) domIds.set(now, was);
  }

  // A node the renderer prunes puts NO id on the page, so none of its ids may
  // be rewritten: renaming one and following every reference to it leaves a
  // visible sibling's `#hero` pointing at a minted id nothing owns, where
  // before it reached the destination's own `hero`.
  //
  // A RESTORE is the exception, and walks with an empty set. Gating decides
  // what may be RENAMED, because a rename has to avoid the ids a page renders
  // — a question about the page. Putting an id BACK asks nothing about the
  // page: the insert renamed only ungated nodes, so everything in a restore map
  // was renamed while visible, and a node an author gated afterwards still
  // holds the minted id and still has to give it up. Leaving it behind restored
  // the reference and not its target, pointing the two at different ids.
  const hidden = restoring ? EMPTY_NODE_SET : hiddenSubtreeNodes(nodes);
  const rebuilt = mapForest(nodes, original =>
    reidOneKeepingReferences(original, nodeIds, domIds, domIdPolicy, hidden)
  );
  // A SECOND pass, because a node may reference an id defined on a node the
  // first had not reached yet. Without it a copied `aria-labelledby` points at
  // the original's id, so the copy loses its accessible name — the same gap
  // composition has, closed the same way.
  // The same pass points a binding naming the list it reads at the copy of
  // that list, when this copy re-identified it.
  const linked = mapForest(rebuilt, copy =>
    withListsRelinked(relinkOne(copy, domIds), nodeIds)
  );
  return { nodes: linked, nodeIds, domIds };
}

/**
 * One copied node, with every reference to a re-minted id following the copy.
 *
 * Both halves matter and only one of them is markup. `aria-labelledby` lives in
 * `attributes`; a link's target lives in `props` as `href: "#pricing"`, and a
 * copy that moves the id without the link leaves the anchor resolving to
 * nothing. Applied HERE rather than left to each caller, because the caller
 * that forgets does not fail — it stores a document that renders, validates and
 * quietly points somewhere else.
 */
function relinkOne(
  copy: BlockNode,
  domIds: Pick<ReadonlyMap<string, string>, "get" | "size">
): BlockNode {
  // `isPlainRecord`, not `!== undefined`. A persisted `attributes: null` is
  // content the first pass deliberately carries through untouched, and handing
  // it to the remapper enumerates null and throws — a rebuild that destroys a
  // node because of a field on a different one.
  const attributes = isPlainRecord(copy.attributes)
    ? remapIdReferences(copy.attributes, domIds)
    : copy.attributes;
  // See `fragment-refs` for why a copier may rewrite a prop it has no schema
  // for: only a whole string of `#` plus an id THIS copy minted is touched, and
  // nothing but a reference to the copy's own target can spell that.
  const props = remapFragmentProps(copy.props, domIds) as BlockNode["props"];
  // And the BOUND form of the same field. A bound `href` keeps its literal in
  // `bindings.href.fallback`, which is what renders when the source is empty —
  // so leaving it behind makes the link work until the data does not, which is
  // the one case the fallback exists for.
  const bindings = remapFragmentBindings(
    copy.bindings,
    domIds
  ) as BlockNode["bindings"];
  // Every remapper returns its input unchanged when nothing matched, so an
  // ordinary node is returned as it stands rather than reallocated.
  if (
    attributes === copy.attributes &&
    props === copy.props &&
    bindings === copy.bindings
  ) {
    return copy;
  }
  // Spread CONDITIONALLY. `{ ...copy, bindings }` writes the key even when the
  // value is `undefined`, and a key holding `undefined` is a value JSON cannot
  // carry — `applyOp` refuses the whole insert for it. An ordinary node has no
  // `bindings`, so any copy that relinked anything at all produced an op group
  // the apply then rejected, and the planner's dry run promised an insert that
  // could not happen.
  return {
    ...copy,
    ...(attributes === undefined ? {} : { attributes }),
    ...(props === undefined ? {} : { props }),
    ...(bindings === undefined ? {} : { bindings }),
  };
}

/**
 * Which of a set of candidate DOM ids one subtree's REFERENCES actually reach.
 *
 * A copy's rename record has to cover every id the copy still points at, not
 * only the ids it renders. One root can define `#hero` while a sibling names it
 * through `aria-describedby`, a `href="#hero"` prop, or that href's binding
 * fallback — {@link reidForestWithMap} rewrites all three across the whole
 * forest, so a record built from rendered ids alone leaves the referencing root
 * with a page-specific id and no way back to what its source called it.
 *
 * Answered by RUNNING the relink pass rather than by a second enumeration of
 * which fields hold a reference. That list lives in three places already
 * ({@link ID_REFERENCE_ATTRIBUTES} and the two fragment remappers), and a
 * fourth reader of it would agree with them exactly until one of them gained a
 * carrier — at which point this would go on reporting a complete record while
 * silently missing the new one. Running the pass cannot drift from the pass.
 *
 * The rewritten nodes are DISCARDED; only which lookups the pass made is kept.
 * One entry per root, positionally, so the work is linear in the forest however
 * many entries the candidate map holds.
 */
export function referencedDomIds(
  roots: readonly BlockNode[],
  candidates: ReadonlyMap<string, string>
): ReadonlyMap<string, string>[] {
  const perRoot = roots.map(() => new Map<string, string>());
  if (candidates.size === 0) return perRoot;
  // ONE probe for the whole forest, and the root being walked decides where a
  // hit is recorded. Copying the candidates per root would put the map's size
  // into the per-root cost — the same shape as recording every root's renames
  // on every root, which made a wide pattern's work grow with its square.
  //
  // A real `Map`, so every member the remappers reach — `size` as well as
  // `get` — behaves as they expect; only the lookup is observed.
  let used = perRoot[0];
  const probe = new Map(candidates);
  const lookup = probe.get.bind(probe);
  probe.get = (key: string): string | undefined => {
    const found = lookup(key);
    if (found !== undefined) used.set(key, found);
    return found;
  };
  roots.forEach((root, index) => {
    used = perRoot[index]!;
    mapForest([root], copy => relinkOne(copy, probe));
  });
  return perRoot;
}

/** One node, re-identified, with its DOM id remapped rather than removed. */
/**
 * What a moving DOM id becomes: the recorded original, or a minted one.
 *
 * Both answers go through the caller's memo, so a subtree spelling one id on
 * two nodes still maps both to a single replacement and a reference to it still
 * reaches one target.
 *
 * A `restore` policy that does not name this id falls back to minting, which
 * cannot happen through {@link movesUnder} — that only lets an id move when the
 * map holds it — and is the safe answer rather than returning the id unchanged,
 * which would be a copy silently keeping an id it was told to move.
 */
function replacementFor(
  value: string,
  nodeId: string,
  policy: SharedDomIdPolicy
): string {
  if (typeof policy === "object" && "restore" in policy) {
    return policy.restore.get(value) ?? mintDomId(value, nodeId);
  }
  return mintDomId(value, nodeId);
}

/**
 * Whether the id this node RENDERS changes under the policy it was given.
 *
 * Only the rendered one is ever a candidate — a node can spell two and emits
 * one, and moving the shadowed spelling makes the relink pass rewrite every
 * reference to an id nothing renders.
 *
 * Its own function because the copier it serves is at the complexity the gate
 * allows, and because the four policies read as one question here rather than
 * as a condition threaded through two rewrite sites.
 */
function movesUnder(
  value: string,
  rendered: string | undefined,
  policy: SharedDomIdPolicy
): boolean {
  if (value !== rendered) return false;
  if (policy === "remint") return true;
  if (policy === "keep") return false;
  if ("restore" in policy) return policy.restore.has(value);
  return policy.avoid.has(value);
}

function reidOneKeepingReferences(
  node: BlockNode,
  nodeIds: Map<string, string>,
  domIds: Map<string, string>,
  domIdPolicy: SharedDomIdPolicy,
  hidden: ReadonlySet<BlockNode>
): BlockNode {
  const { copy, slots } = identifiedCopy(node, nodeIds);

  // `mintDomId` is asked once per distinct ORIGINAL id, so a subtree whose two
  // nodes carry the same DOM id maps both to one replacement. That preserves
  // the document's own meaning: the pair pointed at one target before, and a
  // reference to it still reaches one target after.
  const remap = (value: string): string => {
    const existing = domIds.get(value);
    if (existing !== undefined) return existing;
    const replacement = replacementFor(value, copy.id, domIdPolicy);
    domIds.set(value, replacement);
    return replacement;
  };

  // An id that is NOT minted contributes no entry to `domIds`, which is the
  // honest record: nothing moved, so the relink pass that follows has nothing
  // to rewrite and every reference still names the id it named. Identity
  // entries would say the same thing less clearly and make a caller checking
  // the map against its destination report collisions it is not introducing.
  //
  // Only the id this node RENDERS is a candidate. A node can spell two and
  // emits one, and minting the shadowed spelling is worse than pointless: the
  // relink pass then rewrites every reference to it, so a link that deliberately
  // reached an element in the DESTINATION now names a minted id nothing renders
  // at all. Both spellings move together when they carry the same value, since
  // the memo maps one original to one replacement — so the node still spells a
  // single id afterwards.
  const rendered = hidden.has(node) ? undefined : renderedDomId(node);
  const moves = (value: string): boolean =>
    movesUnder(value, rendered, domIdPolicy);

  moveOwnIds(copy, moves, remap);

  if (slots !== undefined) copy.slots = slots;
  return copy;
}

/**
 * One node's own fields, freshly identified, with its slots handed back.
 *
 * Clone only this node's own fields; descendants are cloned as the rebuild
 * reaches them, so cloning `slots` here too would deep-copy them twice.
 */
function identifiedCopy(
  node: BlockNode,
  nodeIds: Map<string, string>
): { copy: BlockNode; slots: BlockNode["slots"] } {
  const { slots, ...own } = node;
  const copy: BlockNode = { ...structuredClone(own), id: newId() };
  if (typeof node.id === "string") nodeIds.set(node.id, copy.id);
  return { copy, slots };
}

/**
 * Rewrite a copy's own DOM id spellings, in place, where one moves.
 *
 * Both spellings — the dedicated `cssId` and an `id` in the attribute bag,
 * matched case-insensitively — so a node spelling one id through both still
 * spells a single id afterwards.
 */
function moveOwnIds(
  copy: BlockNode,
  moves: (value: string) => boolean,
  remap: (value: string) => string
): void {
  if (
    typeof copy.cssId === "string" &&
    copy.cssId !== "" &&
    moves(copy.cssId)
  ) {
    copy.cssId = remap(copy.cssId);
  }
  if (copy.attributes) {
    copy.attributes = Object.fromEntries(
      Object.entries(copy.attributes).map(([key, value]) =>
        key.toLowerCase() === "id" &&
        typeof value === "string" &&
        value !== "" &&
        moves(value)
          ? [key, remap(value)]
          : [key, value]
      )
    );
  }
}

/** Asks the per-node restore about one node's id. */
type RestoreEach = (node: BlockNode, value: string) => string | undefined;

/** What the per-node copier carries from node to node. */
interface EachCopy {
  readonly nodeIds: Map<string, string>;
  /** Each id a VISIBLE node renders → every id those nodes ended up with. */
  readonly outcomes: Map<string, Set<string>>;
  /** The same, for nodes inside a subtree the renderer prunes. */
  readonly gatedOutcomes: Map<string, Set<string>>;
  /** Every node the renderer would prune, by identity. */
  readonly hidden: ReadonlySet<BlockNode>;
  /** Each copy's id → the original it was made from, for the reference pass. */
  readonly holders: Map<string, BlockNode>;
  readonly restoreEach: RestoreEach;
}

/**
 * The forest copy under {@link DomIdPolicy} `restoreEach`.
 *
 * Two passes, as every policy takes. The first moves the id each node renders
 * to that node's own answer and notes, per id, every id its renderers ended up
 * with. The second rewrites references: a reference its holder has an answer
 * for takes that answer, and only one it has none for follows the id those notes
 * settle.
 *
 * The holder first, because it knows where its reference pointed. Settling a
 * reference by its target instead means deciding which elements render
 * together, and that question has no end: gated namesakes, nested gates, a node
 * placed under two gates, sibling gates whose conditions agree, and conditions
 * equal in meaning but written differently, which nothing can decide from the
 * document. Following the target is kept for the reference nobody recorded.
 *
 * Gating decides only which nodes a reference follows, never which ids move.
 * Putting an id back asks nothing about the page, so a gated node still has its
 * own id restored. But a reference resolves to the element the page RENDERS,
 * and a gated namesake renders nothing — so the nodes the renderer keeps settle
 * a reference first, and gated ones only when no visible node carries the id.
 * Treating both alike made a visible target and its gated namesake look
 * contested, and left an unrelated link on an id nothing renders.
 *
 * No shared memo of replacements: two nodes spelling one id may answer
 * differently, which a memo keyed by the id alone would collapse into one
 * answer for both.
 *
 * `domIds` reports a rendered id only where the nodes that settle it all moved
 * to the same id — the one reading of "what this copy moved" that stays true
 * when renderers disagree.
 */
function reidForestRestoringEach(
  nodes: BlockNode[],
  restoreEach: RestoreEach
): ReidentifiedForest {
  const each: EachCopy = {
    nodeIds: new Map(),
    outcomes: new Map(),
    gatedOutcomes: new Map(),
    // Gated where no placement of the node is open. The pruning rule's own walk,
    // read the other way: `hiddenSubtreeNodes` asks whether ANY placement is
    // pruned, and a node an unrelated reference follows renders wherever any
    // placement is not.
    hidden: prunedInEveryPlacement(nodes),
    holders: new Map(),
    restoreEach,
  };
  const rebuilt = mapForest(nodes, original =>
    reidOneRestoringEach(original, each)
  );
  // By the copy's id rather than its object: a node the first pass changed is
  // a new object once the rebuild puts its slots back, so it may not be the one
  // this pass is handed.
  const linked = mapForest(rebuilt, copy =>
    withListsRelinked(
      relinkOne(copy, referenceAnswers(each.holders.get(copy.id), each)),
      each.nodeIds
    )
  );
  return {
    nodes: linked,
    nodeIds: each.nodeIds,
    domIds: settledMoves(each),
  };
}

function reidOneRestoringEach(node: BlockNode, each: EachCopy): BlockNode {
  const { copy, slots } = identifiedCopy(node, each.nodeIds);
  each.holders.set(copy.id, node);
  // Only the id this node RENDERS, for the reason every policy gives: the
  // shadowed spelling reaches no page, and moving it rewrites references to an
  // id nothing renders.
  const rendered = renderedDomId(node);
  if (rendered !== undefined) {
    const answer = each.restoreEach(node, rendered);
    noteOutcome(
      each.hidden.has(node) ? each.gatedOutcomes : each.outcomes,
      rendered,
      answer ?? rendered
    );
    if (answer !== undefined) {
      moveOwnIds(
        copy,
        value => value === rendered,
        () => answer
      );
    }
  }
  if (slots !== undefined) copy.slots = slots;
  return copy;
}

function noteOutcome(
  outcomes: Map<string, Set<string>>,
  value: string,
  became: string
): void {
  const found = outcomes.get(value);
  if (found === undefined) outcomes.set(value, new Set([became]));
  else found.add(became);
}

/** The one id every renderer of an id ended up with, or nothing. */
function soleOutcome(
  became: ReadonlySet<string> | undefined
): string | undefined {
  if (became === undefined || became.size !== 1) return undefined;
  const [only] = became;
  return only;
}

/**
 * The one id a reference to `value` follows, or nothing when the copy does not
 * settle it.
 *
 * The nodes the page renders decide whenever any of them carries the id; gated
 * nodes decide only where none does, so a link to a target that is gated today
 * still follows it and is not split from it when the gate opens.
 */
function settledTarget(each: EachCopy, value: string): string | undefined {
  const visible = each.outcomes.get(value);
  if (visible !== undefined) return soleOutcome(visible);
  return soleOutcome(each.gatedOutcomes.get(value));
}

/** Each rendered id that moved, to the one id the nodes settling it became. */
function settledMoves(each: EachCopy): Map<string, string> {
  const moved = new Map<string, string>();
  const values = new Set([
    ...each.outcomes.keys(),
    ...each.gatedOutcomes.keys(),
  ]);
  for (const value of values) {
    const only = settledTarget(each, value);
    if (only !== undefined && only !== value) moved.set(value, only);
  }
  return moved;
}

/**
 * What each id one node references should now be.
 *
 * The holder's own answer where it has one. Otherwise settled by the copy where
 * it can be: an id the forest renders, whose settling renderers all ended up
 * with one id, is that id — kept or moved. Otherwise the reference is kept.
 *
 * A lookup rather than a map, because the answer depends on the holder and
 * building a whole map per node would put every id the records name into the
 * cost of every node. `size` is never zero: whether a reference moves is only
 * known per id, so the rewriters must always look.
 */
function referenceAnswers(
  holder: BlockNode | undefined,
  each: EachCopy
): Pick<ReadonlyMap<string, string>, "get" | "size"> {
  return {
    size: 1,
    get(value: string): string | undefined {
      const own =
        holder === undefined ? undefined : each.restoreEach(holder, value);
      if (own !== undefined) return own;
      const settled = settledTarget(each, value);
      return settled === value ? undefined : settled;
    },
  };
}

/**
 * Attributes whose VALUE is an id, or a whitespace-separated list of ids.
 *
 * Remapping a `cssId` without these breaks every relationship built on it:
 * `aria-labelledby` and `aria-describedby` are how a control is NAMED and
 * DESCRIBED to a screen reader, and a reference to an id that no longer exists
 * is silently ignored — the element simply loses its name. That failure is
 * invisible to everyone who does not use assistive technology, which is why it
 * is listed as data here rather than left to each copier to remember.
 *
 * Single-id and list-valued attributes are not separated, because the rewrite
 * does not need them to be: a single id is a one-token list, and splitting on
 * whitespace handles both without a second table to keep in step.
 *
 * Lowercase, and compared after folding, because HTML attribute names are
 * case-insensitive and a stored `aria-labelledBy` addresses the same thing.
 */
export const ID_REFERENCE_ATTRIBUTES: readonly string[] = [
  // HTML
  "for",
  "form",
  "list",
  "headers",
  "itemref",
  "popovertarget",
  "anchor",
  // ARIA
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
];

const ID_REFERENCE_SET = new Set(ID_REFERENCE_ATTRIBUTES);

/**
 * An IDREFS value as its tokens, with the separators gone.
 *
 * The single statement of what such a value MEANS: a list of ids, where runs of
 * whitespace are one separator and a leading or trailing one is nothing. Every
 * parser reads `"hero   label"` and `"hero label"` as the same two references,
 * and {@link remapIdReferences} writes both back as the second.
 *
 * Published because a second reader now depends on that being true rather than
 * merely doing the same thing: a fingerprint of what a copy carries has to
 * normalise exactly where the copier normalises, and a parallel `split`
 * elsewhere would agree until one of them changed.
 */
export function idReferenceTokens(value: string): string[] {
  return value.split(/\s+/).filter(token => token !== "");
}

/**
 * Point a node's id REFERENCES at wherever those ids ended up.
 *
 * Applied as a second pass, after every id has been minted, and that ordering
 * is the whole reason it is a separate function: a node may reference an id
 * defined on a node the walk has not reached yet, so rewriting during the copy
 * would leave every forward reference pointing at the original.
 *
 * A token with no entry in the map is left ALONE rather than dropped. It
 * addresses something outside the copied subtree — an element the host page
 * owns, or one the application renders — and rewriting or removing it would
 * break a relationship that was working.
 *
 * Returns the SAME record when nothing referenced anything, so the ordinary
 * node allocates nothing.
 */
export function remapIdReferences(
  attributes: Record<string, string>,
  domIds: Pick<ReadonlyMap<string, string>, "get" | "size">
): Record<string, string> {
  if (domIds.size === 0) return attributes;
  let changed = false;
  const next: Record<string, string> = {};
  for (const name of Object.keys(attributes)) {
    const value = ownEntry(attributes, name);
    if (
      typeof value !== "string" ||
      !ID_REFERENCE_SET.has(name.toLowerCase())
    ) {
      defineEntry(next, name, value as string);
      continue;
    }
    // Token by token, through the one spelling of what an IDREFS list IS.
    const mapped = idReferenceTokens(value).map(
      token => domIds.get(token) ?? token
    );
    const rewritten = mapped.join(" ");
    if (rewritten !== value) changed = true;
    defineEntry(next, name, rewritten);
  }
  return changed ? next : attributes;
}

/**
 * Every node inside a subtree the renderer will prune, by identity.
 *
 * Gating is INHERITED: `pruneHiddenNodes` drops a gated node with everything
 * under it, so an ungated child of a gated parent does not reach the page
 * either. Asking `isConditionGated` of each node alone answers about that child
 * and gets it wrong.
 *
 * Shared, because two different questions need the same answer and got it
 * separately once already — which DOM ids a document has in use, and which of a
 * copy's ids may be rewritten. When those disagree, a copy renames an id nobody
 * renders and every reference to it follows the rename to nothing.
 *
 * Keyed on identity rather than on `id`, because a malformed document can spell
 * one id on two nodes and this is asked of the objects being walked.
 */
export function hiddenSubtreeNodes(
  nodes: readonly BlockNode[]
): ReadonlySet<BlockNode> {
  return placementGating(nodes).gated;
}

/**
 * Every node no placement of which is open, by identity.
 *
 * The walk reaches a node object placed in two slots once per placement. A
 * placement under a gate is pruned and one under none renders, so such a node
 * renders wherever any placement is open — the question an unrelated reference
 * following its target needs answered, where {@link hiddenSubtreeNodes} answers
 * whether any placement is pruned.
 */
function prunedInEveryPlacement(
  nodes: readonly BlockNode[]
): ReadonlySet<BlockNode> {
  const { gated, open } = placementGating(nodes);
  return new Set([...gated].filter(node => !open.has(node)));
}

/**
 * Which nodes are reached under a gate on some placement, and which are reached
 * under none on some placement.
 *
 * One walk for both readings, so the pruning rule and its converse cannot come
 * to disagree about inheritance. A placement inherits from its parent's CURRENT
 * visit, because the gate over a placement is the one on the path it was
 * reached by.
 */
function placementGating(nodes: readonly BlockNode[]): {
  gated: Set<BlockNode>;
  open: Set<BlockNode>;
} {
  const gated = new Set<BlockNode>();
  const open = new Set<BlockNode>();
  const current = new Map<BlockNode, boolean>();
  walkNodes([...nodes], (node, parent) => {
    const inherited = parent !== undefined && current.get(parent) === true;
    const isGated = inherited || isConditionGated(node);
    current.set(node, isGated);
    (isGated ? gated : open).add(node);
  });
  return { gated, open };
}

/**
 * A replacement DOM id, derived from the original.
 *
 * The suffix comes from the node's NEW id, so the same original inside two
 * copies of one pattern produces two different replacements — which is the
 * collision the remap exists to avoid. Trimmed to keep the result readable in a
 * URL fragment; the full node id is not needed for uniqueness within a subtree
 * that has exactly one node per new id.
 *
 * Exported because a second copier now exists. Composition inlines one
 * definition into every instance of it, which duplicates the definition's
 * `cssId` and `attributes.id` exactly as pattern insert duplicates a subtree's
 * — and a document may legitimately hold both, so the two must agree on what a
 * replacement looks like or one page carries two spellings of the same rule.
 * The COPY policy is shared; the id policy is not, because these ids are
 * derived and `reidSubtree`'s are random.
 */
export function mintDomId(original: string, newNodeId: string): string {
  return `${original}-${newNodeId.replace(/-/g, "").slice(0, 8)}`;
}

/** One node's own fields, freshly identified. Slots are the rebuild's job. */
function reidOne(node: BlockNode): BlockNode {
  // Clone only this node's own fields; descendants are cloned as the rebuild
  // reaches them, so cloning `slots` here too would deep-copy them twice.
  const { slots, ...own } = node;
  const copy: BlockNode = { ...structuredClone(own), id: newId() };
  // A re-id'd node is a distinct element: it must not carry the original's DOM
  // id, or the two would emit duplicate HTML `id` attributes. The id can arrive
  // two ways — the dedicated `cssId` field and the custom-attributes escape
  // hatch (`attributes.id`, matched case-insensitively) — so drop both.
  delete copy.cssId;
  if (copy.attributes) {
    const attributes = Object.fromEntries(
      Object.entries(copy.attributes).filter(
        ([key]) => key.toLowerCase() !== "id"
      )
    );
    if (Object.keys(attributes).length > 0) copy.attributes = attributes;
    else delete copy.attributes;
  }
  // Handed back so the rebuild knows this node HAS slots to descend into; it
  // replaces them with the rebuilt lists.
  if (slots !== undefined) copy.slots = slots;
  return copy;
}

/** Insert a re-id'd copy of a node immediately after the original. */
export function duplicateNode(nodes: BlockNode[], id: string): BlockNode[] {
  const found = findNode(nodes, id);
  if (!found) return nodes;
  // No check that the forest can be serialized. This once refused outright when
  // any part of the forest was cyclic, which made it the only primitive that
  // declined work because of a defect elsewhere in the document — see the
  // storability note on `tree.ts`.
  //
  // The clone is safe on its own terms regardless: `reidSubtree` rebuilds it
  // without the edge that closes a cycle, so what gets inserted is acyclic even
  // when its source was not.
  const location = locateNode(nodes, id);
  if (!location) return nodes;
  return insertNode(nodes, reidSubtree(found), {
    parentId: location.parent?.id,
    slot: location.slot,
    index: location.index + 1,
  });
}
