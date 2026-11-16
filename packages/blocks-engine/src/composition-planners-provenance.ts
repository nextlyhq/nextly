/**
 * What a copy into a page records about where it came from: the insert ops,
 * the provenance each inserted root carries (its pattern and the ids it had
 * to rename), reading that record back, and restoring renamed ids when a run
 * is saved again.
 *
 * @module composition-planners-provenance
 */
import type {
  InsertTarget,
  PlanRefusal,
} from "./composition-planners-contract";
import {
  type Placement,
  walkRenderedIds,
} from "./composition-planners-refusals";
import {
  type BlockDocument,
  type BlockNode,
  type BlockOrigin,
  patternRenameRecord,
  renderedDomId,
} from "./document";
import type { DocumentLimits } from "./limits";
import { insertKeepingLocks } from "./locked-insert";
import { boundedLimit } from "./measure-bytes";
import type { BuilderOp, OpPosition } from "./ops";
import {
  type DomIdPolicy,
  mapForest,
  referencedDomIds,
  walkNodes,
} from "./tree";

/**
 * The edits, in the order they must apply.
 *
 * Each root goes one index after the last, so a run inserted together arrives
 * in the order it was saved. Every position is computed against the document as
 * it will be WHEN THAT OP RUNS, which is why the index advances: the op before
 * it has already shifted every later sibling along.
 *
 * The `"document"` target removes first. A remove addresses a node by id and
 * ids do not move, so the order among the removes does not matter — but they
 * must all precede the inserts, or the pattern's roots would be counted among
 * the roots being cleared away.
 *
 * ## A locked block arrives unlocked and is locked once it has landed
 *
 * Through `insertKeepingLocks`, the one sequence every copy into a document
 * uses: a pattern's locked block is placeable, and its undo still works.
 */
export function insertOps(
  roots: readonly BlockNode[],
  place: Placement,
  document: BlockDocument,
  target: InsertTarget
): BuilderOp[] {
  const ops: BuilderOp[] =
    target === "document"
      ? document.nodes.map(node => ({ kind: "remove", id: node.id }))
      : [];
  const start = place.at === null ? 0 : place.at.index;
  const placed = roots.map((node, offset) => {
    const at: OpPosition =
      place.at === null || place.at.parentId === undefined
        ? { index: start + offset }
        : {
            parentId: place.at.parentId,
            slot: place.at.slot,
            index: start + offset,
          };
    return { node, at };
  });
  return [...ops, ...insertKeepingLocks(placed)];
}

/**
 * The forest with every provenance record removed.
 *
 * A stored pattern's nodes came from the PAGE, not from wherever the page's
 * nodes came from. Carrying an inherited `origin` across would make a pattern
 * saved out of already-inserted content claim a source it never had — and a
 * later "has the upstream changed" check would then compare against the wrong
 * pattern and answer confidently, which is worse than having no record at all.
 */
export function withoutOrigin(roots: readonly BlockNode[]): BlockNode[] {
  return mapForest([...roots], node => {
    if (node.origin === undefined) return node;
    const { origin: _origin, ...rest } = node;
    return rest;
  });
}

/**
 * The inserted roots, each recording the pattern AND the renames that are its
 * own.
 *
 * Per root, not one map repeated. The copy renames across the whole forest, so
 * attaching the complete map to every root makes the stored document and the op
 * group grow with the SQUARE of the pattern's width — measured, a 40-root
 * pattern landing beside a colliding copy carried 1600 entries where 40 were
 * meant, and a 250-root one produced an op group the default document cap
 * refuses outright. The feature would then break exactly the large patterns it
 * is most useful for.
 *
 * Matched by POSITION, because `reidForestWithMap` rebuilds the forest in the
 * order it was given and this is the same list. Read off the SOURCE roots, since
 * the map is keyed on the ids as the source spells them.
 */
export function withInsertOrigin(
  copied: readonly BlockNode[],
  source: readonly BlockNode[],
  patternId: string,
  digest: string,
  renamed: ReadonlyMap<string, string>
): BlockNode[] {
  // Asked of the whole forest ONCE: the relink pass runs per root either way,
  // but the candidate map is built a single time rather than per root.
  const referenced = referencedDomIds(source, renamed);
  const carriers = carriersIn(copied, renamed);
  return copied.map((root, index) => {
    const mine = renamedFor(source[index], renamed, referenced[index]);
    return {
      ...root,
      origin: insertOrigin(patternId, digest, mine, nodesFor(mine, carriers)),
    };
  });
}

/**
 * Every node of the COPY carrying each id the copy renamed, keyed by how the
 * source spells it.
 *
 * Read off the copy after renaming rather than off the source, so the list is
 * what the rename actually did: a node it skipped — one gated when it was
 * inserted keeps the source's spelling — carries no replacement and is not
 * named. Across the whole forest, because a root records a rename it only
 * references, and the node carrying that id sits under a sibling root.
 */
function carriersIn(
  copied: readonly BlockNode[],
  renamed: ReadonlyMap<string, string>
): Map<string, Set<string>> {
  const carriers = new Map<string, Set<string>>();
  if (renamed.size === 0) return carriers;
  const sources = new Map<string, string>();
  for (const [was, now] of renamed) sources.set(now, was);
  walkNodes([...copied], node => {
    const domId = renderedDomId(node);
    const was = domId === undefined ? undefined : sources.get(domId);
    if (was === undefined) return;
    const found = carriers.get(was);
    if (found === undefined) carriers.set(was, new Set([node.id]));
    else found.add(node.id);
  });
  return carriers;
}

/** One root's node lists: one per rename it records, possibly empty. */
function nodesFor(
  mine: ReadonlyMap<string, string>,
  carriers: ReadonlyMap<string, ReadonlySet<string>>
): Map<string, ReadonlySet<string>> {
  const nodes = new Map<string, ReadonlySet<string>>();
  for (const was of mine.keys()) {
    nodes.set(was, carriers.get(was) ?? new Set());
  }
  return nodes;
}

/**
 * The entries naming a DOM id this one root actually uses.
 *
 * USES, not renders. A root participates in a rename two ways, matching the two
 * passes `reidForestWithMap` makes: it can RENDER an id that had to move,
 * and it can REFERENCE one that moved on a sibling — an `aria-describedby`, a
 * `href="#hero"`, or that href's binding fallback. The relink pass rewrites the
 * second across the whole forest, so a record covering only the first left the
 * referencing root carrying a page-specific id that no later save could put
 * back: saved on its own, it went into the library still pointing at
 * `hero-761f34a2`, which resolves to nothing anywhere else.
 *
 * Each half is asked of the pass that performs it, so neither can drift from
 * what the copier actually did.
 */
function renamedFor(
  source: BlockNode | undefined,
  renamed: ReadonlyMap<string, string>,
  referenced: ReadonlyMap<string, string> | undefined
): ReadonlyMap<string, string> {
  if (source === undefined || renamed.size === 0) return new Map();
  const mine = new Map<string, string>(referenced);
  // Through the shared walk that answers what reaches the page, so this and the
  // copier cannot come to disagree about which ids a root carries.
  walkRenderedIds([source], id => {
    const now = renamed.get(id);
    if (now !== undefined) mine.set(id, now);
  });
  return mine;
}

/**
 * The provenance record an insert writes, carrying what it had to rename.
 *
 * `renamed` is omitted when nothing moved rather than written empty, matching
 * every other "absent means none" field in this contract — and making a copy
 * that renamed nothing byte-identical to one taken before this was recorded.
 * `renamedNodes` goes with it for the same reason, and is also omitted when the
 * caller has no lists to write: a record restamped from one that predates them
 * stays in that shape rather than acquiring lists nobody recorded.
 */
function insertOrigin(
  patternId: string,
  digest: string,
  renamed: ReadonlyMap<string, string>,
  renamedNodes: ReadonlyMap<string, ReadonlySet<string>> | undefined
): BlockOrigin {
  if (renamed.size === 0) return { from: "pattern", id: patternId, digest };
  return {
    from: "pattern",
    id: patternId,
    digest,
    renamed: Object.fromEntries(renamed),
    ...(renamedNodes === undefined
      ? {}
      : {
          renamedNodes: Object.fromEntries(
            [...renamedNodes].map(([was, nodes]) => [was, [...nodes]])
          ),
        }),
  };
}

/**
 * What a node's own `origin` property says, from ONE read of it.
 *
 * Two questions and one reading, because they were two readings and a stored
 * node can be a Proxy: a `getOwnPropertyDescriptor` trap answering the boundary
 * question with one record and the contents question with another had the scope
 * established by an origin that renamed nothing and the ids rewritten by one
 * that renamed `pricing`. Nothing detects that afterwards — both readings are
 * individually valid.
 *
 * The read runs no user code. A `get` accessor is a record present and not
 * readable, which is exactly the case that must still bound the scope.
 */
interface NodeOrigin {
  /**
   * Whether the node CLAIMS provenance of its own, readable or not.
   *
   * The boundary question, and deliberately not the same as whether the record
   * is usable. A node carrying a malformed or unreadable origin is a node
   * saying it came from somewhere — and an ancestor's rename map is about the
   * run the ancestor was copied as, which this node is announcing it is not
   * part of. Applying it anyway rewrites an id on the strength of uncertainty.
   */
  readonly claims: boolean;
  /**
   * The record itself, when it is stored data a reader may act on.
   *
   * An ordinary read walks the prototype chain, so a polluted
   * `Object.prototype.origin` makes every node on a page look copied from
   * somewhere. Measured: a selection of one ordinary node came back stale
   * against a pattern it had never seen, and the plan emitted an update
   * stamping that false provenance onto it. The document validator answers this
   * about OWN properties only, and the two have to agree — a record one road
   * sees and the other does not is exactly the asymmetry these planners exist
   * to close.
   *
   * Absent for an accessor, for the reason the validator treats one as absent:
   * reading it runs the document's own code inside the decision about whether
   * to trust it. Absent too for a NON-ENUMERABLE record, which `JSON.stringify`,
   * an object spread and `structuredClone` all drop — acting on its contents
   * restores an id from metadata the saved document will not carry. Such a
   * record still CLAIMS, which is the other field's question: a record that
   * cannot be stored is still a node saying it came from somewhere.
   *
   * REQUIRED and possibly `undefined`, never optional. An optional field is
   * absent from the object, so reading it walks the prototype chain — and with
   * `Object.prototype.origin` polluted, "this node holds no record" answered
   * with the ghost record, in the one type built to keep that answer honest.
   * Spelling it out makes every value of this type carry its own answer.
   */
  readonly origin: BlockOrigin | undefined;
}

/** A node claiming nothing, and one whose claim is all that can be read. */
const CLAIMS_NOTHING: NodeOrigin = { claims: false, origin: undefined };
const CLAIMS_UNREADABLY: NodeOrigin = { claims: true, origin: undefined };

export function nodeOrigin(node: BlockNode): NodeOrigin {
  // Reflection on a Proxy runs a caller-supplied trap, and this walk reaches
  // every node in the document rather than the selected roots — so a hostile
  // `getOwnPropertyDescriptor` on a node nothing selected would take a valid
  // save out with a native error. A node that will not say what it holds is
  // still a node that would not answer, so it bounds the scope.
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(node, "origin");
  } catch {
    return CLAIMS_UNREADABLY;
  }
  if (descriptor === undefined) return CLAIMS_NOTHING;
  if (!("value" in descriptor)) return CLAIMS_UNREADABLY;
  const value = descriptor.value as BlockOrigin | undefined;
  // `origin: undefined` is NOT a claim. The field is optional and JSON omits
  // it, so an own property holding `undefined` is how "no origin" is spelled in
  // memory — the validator reads it that way, and treating it as a boundary
  // would stop an ancestor's rename reaching a node that never announced
  // anything.
  if (value === undefined) return CLAIMS_NOTHING;
  if (descriptor.enumerable !== true) return CLAIMS_UNREADABLY;
  return { claims: true, origin: value };
}

/**
 * The renames a root already carries and the nodes they were applied to, as
 * the record spells them.
 *
 * Read back out of the provenance rather than recomputed, because only the
 * insert that did the renaming knows it — recovering it from the values is the
 * inference this feature exists instead of.
 *
 * `nodes` is absent for a record written before node lists were recorded, and
 * every reader of this keeps that apart from an empty list: the first is read
 * by value, the second names no node.
 */
interface RecordedRenames {
  readonly renames: ReadonlyMap<string, string>;
  readonly nodes: ReadonlyMap<string, ReadonlySet<string>> | undefined;
}

function recordedRenames(origin: BlockOrigin | undefined): RecordedRenames {
  // The DOCUMENT module's reading, not a second one here, and ONE of it for
  // both halves. What a record must carry to be trusted and what it says once
  // trusted are one question, and this file used to answer the second half
  // itself: it validated through `isBlockOrigin` and then walked the record
  // again for its contents, so a stored Proxy ran its traps twice and the two
  // readings could disagree about an entry. Asking for the renames and the
  // node lists separately would reopen exactly that between the two.
  const read = origin === undefined ? undefined : patternRenameRecord(origin);
  return { renames: read?.renamed ?? NO_RENAMES, nodes: read?.renamedNodes };
}

/** The record a save-over writes: new digest, the renames it already held. */
export function recordedOrigin(
  patternId: string,
  digest: string,
  origin: BlockOrigin
): BlockOrigin {
  const { renames, nodes } = recordedRenames(origin);
  return insertOrigin(patternId, digest, renames, nodes);
}

/**
 * The renames in scope for a node, and where each was applied.
 *
 * `carriers` is keyed by the CURRENT id, which is what a restore holds when it
 * asks, and is absent for a record written before node lists were recorded.
 */
interface RenameScope {
  readonly renames: ReadonlyMap<string, string>;
  readonly carriers: ReadonlyMap<string, ReadonlySet<string>> | undefined;
}

function scopeOf(origin: BlockOrigin | undefined): RenameScope {
  const { renames, nodes } = recordedRenames(origin);
  if (nodes === undefined) {
    return renames === NO_RENAMES ? NO_SCOPE : { renames, carriers: undefined };
  }
  const carriers = new Map<string, ReadonlySet<string>>();
  for (const [was, now] of renames) {
    carriers.set(now, nodes.get(was) ?? new Set());
  }
  return { renames, carriers };
}

/**
 * Where each node id occurs in a document and the DOM id it carries there,
 * and from that, which recorded renames are still live.
 *
 * A rename recorded against node ids applies while one of those nodes occurs
 * EXACTLY ONCE and still carries the replacement. Deleted, edited to another
 * id, or spelled twice by an untrusted document — any of those, and the entry
 * says nothing about this document, so it is dropped from the scope rather
 * than applied to whatever now carries the value.
 *
 * Asked of the stored node, never of what renders. A gated node renders
 * nothing and still holds the id it was given, which a later save has to put
 * back; reading gating here would retire a rename that is still live.
 *
 * A node whose fields cannot be read — a revoked Proxy somewhere in the
 * document — leaves the index unable to say any id occurs once, so every
 * recorded entry is dropped. Keeping the page's id is the answer that
 * corrupts nothing.
 */
function occurrenceIndex(): {
  note: (node: BlockNode) => void;
  liveScope: (scope: RenameScope) => RenameScope;
} {
  const seen = new Map<string, { count: number; domId: string | undefined }>();
  const live = new Map<RenameScope, RenameScope>();
  let unreadable = false;
  const lookup = (id: string) => (unreadable ? undefined : seen.get(id));
  return {
    note(node) {
      try {
        const id: unknown = node.id;
        if (typeof id !== "string") return;
        const found = seen.get(id);
        if (found === undefined) {
          seen.set(id, { count: 1, domId: renderedDomId(node) });
        } else found.count += 1;
      } catch {
        unreadable = true;
      }
    },
    liveScope(scope) {
      if (scope.carriers === undefined) return scope;
      const known = live.get(scope);
      if (known !== undefined) return known;
      const built = liveEntries(scope.renames, scope.carriers, lookup);
      live.set(scope, built);
      return built;
    },
  };
}

/** A scope keeping only the entries a node listed for them still carries. */
function liveEntries(
  renames: ReadonlyMap<string, string>,
  recorded: ReadonlyMap<string, ReadonlySet<string>>,
  lookup: (
    id: string
  ) => { count: number; domId: string | undefined } | undefined
): RenameScope {
  const kept = new Map<string, string>();
  const carriers = new Map<string, ReadonlySet<string>>();
  for (const [was, now] of renames) {
    const holding = new Set<string>();
    for (const id of recorded.get(now) ?? []) {
      const found = lookup(id);
      if (found?.count === 1 && found.domId === now) holding.add(id);
    }
    if (holding.size === 0) continue;
    kept.set(was, now);
    carriers.set(now, holding);
  }
  return { renames: kept, carriers };
}

/**
 * How a saved run's DOM ids are copied: kept, or put back per node to what the
 * source calls them.
 *
 * Built from the provenance in scope for each node, so a run assembled from two
 * different inserts restores each part against the pattern it came from, and a
 * node with no record in reach keeps every id it carries: nothing renamed it,
 * so there is nothing to put back.
 *
 * Asked PER NODE through {@link DomIdPolicy} `restoreEach`, because one answer
 * per id for the whole run is not enough. Two records can name one current id
 * and disagree about its source name, a record's own node and an unlisted
 * namesake can carry one id, and a reference the run's record governs can sit
 * beside an unrelated author's reference to the same id — in each, the right
 * outcome differs by node. The copier decides which question a node is asked:
 * what the id it renders was, or what an id it references was. A reference takes
 * its node's answer where there is one, and follows its target only where there
 * is none.
 *
 * INVERTED from the record, which reads source → copy because that is the
 * direction an insert renames in.
 *
 * Two copies of ONE pattern in a single selection can both restore to the same
 * id, and the save then refuses as `"duplicate-dom-id"`. That is the honest
 * answer: the run really does hold two elements the source names identically,
 * and storing them under their minted names would put two ids nobody wrote into
 * a library, each to be suffixed again on the next insert.
 *
 * Where a record lists the nodes each rename was applied to, only those nodes
 * are the ones it renamed. A node the author added later and gave the same id
 * carries the value and not the history, so it answers that nothing renamed
 * it — and a record whose listed nodes are gone restores nothing at all. A
 * record written before those lists existed is read by value, as it always
 * was, because it cannot say which node it meant.
 */
export function restorePolicy(
  document: BlockDocument,
  selected: readonly BlockNode[],
  limits: DocumentLimits
): { readonly policy: DomIdPolicy } | PlanRefusal {
  const scopes = renameScopes(document.nodes, limits);
  // Refused for its SIZE, which is the one thing actually wrong with it and the
  // one thing an author can act on. Naming any other cause sends them to repair
  // something sound: the envelope index learned this when a node the document
  // really contained was reported dangling because the index stopped at the
  // cap, and a scope decided from a walk that stopped at the cap would be the
  // same mistake with a rename in place of a pointer.
  if (scopes === undefined) return { problem: "exceeds-limits" };
  // `keep` where nothing in the run has a rename in reach, which is the
  // ordinary save: the copy is then exactly the one a run with no provenance
  // gets, with nothing asked of any node.
  if (!renameInReach(selected, scopes)) return { policy: "keep" };
  return {
    policy: {
      restoreEach: (node, value) => restoredFor(scopes, node, value),
    },
  };
}

/** Whether any node of a run has a rename record in scope. */
function renameInReach(
  selected: readonly BlockNode[],
  scopes: ReadonlyMap<BlockNode, RenameScope>
): boolean {
  let found = false;
  walkNodes([...selected], node => {
    if ((scopes.get(node)?.renames.size ?? 0) > 0) found = true;
  });
  return found;
}

/**
 * What one node's record says an id it carries used to be called, or nothing.
 *
 * The id a node RENDERS is its own to answer for only when its record lists it
 * among the nodes it renamed; an id it merely references is answered by the
 * record in scope.
 */
function restoredFor(
  scopes: ReadonlyMap<BlockNode, RenameScope>,
  node: BlockNode,
  value: string
): string | undefined {
  const scope = scopes.get(node);
  return renderedDomId(node) === value
    ? renderedAnswer(scope, node, value)
    : answerOf(scope, value);
}

/**
 * What a node's scope says the id it RENDERS used to be — and nothing when
 * the scope lists the nodes it renamed and this is not one of them.
 *
 * Only for the node carrying the id itself. A reference is answered by the
 * scope alone, and that answer decides it; the copier falls back to the target
 * only where the scope has none.
 */
function renderedAnswer(
  scope: RenameScope | undefined,
  node: BlockNode,
  now: string
): string | undefined {
  const said = answerOf(scope, now);
  if (said === undefined || scope?.carriers === undefined) return said;
  return scope.carriers.get(now)?.has(node.id) === true ? said : undefined;
}

/**
 * What a node's scope says a current id used to be, or nothing.
 *
 * The inverse of the direction a record is written in, memoised per record so a
 * large selection pays for each distinct one once rather than searching it per
 * carrier.
 */
const inverses = new WeakMap<
  ReadonlyMap<string, string>,
  ReadonlyMap<string, string>
>();

function answerOf(
  scope: RenameScope | undefined,
  now: string
): string | undefined {
  if (scope === undefined) return undefined;
  const renames = scope.renames;
  let inverse = inverses.get(renames);
  if (inverse === undefined) {
    const built = new Map<string, string>();
    for (const [was, minted] of renames) built.set(minted, was);
    inverses.set(renames, built);
    inverse = built;
  }
  return inverse.get(now);
}

/**
 * Each node mapped to the pattern rename record IN SCOPE for it: its own where
 * it carries one, otherwise its nearest ancestor's.
 *
 * The record is stamped on inserted ROOTS only, deliberately — a descendant did
 * not arrive from the pattern separately, and marking every node would make
 * detaching one child read as a second insertion. That leaves a descendant with
 * no record of its own, and saving one as a pattern of its own therefore stored
 * the suffixed, page-specific id: the very growth the restore exists to stop,
 * resuming for that subtree.
 *
 * So the record is INHERITED rather than stamped more widely. A nested insert
 * still wins for its own subtree, because a node carrying a record uses it
 * instead of the one it sits inside.
 *
 * Keyed by the NODE, never by its id. A document reaching a planner is
 * untrusted and may spell one id twice, and the scope a node inherits is its
 * PARENT's — so an id-keyed map hands a node under one container the record
 * belonging to a different container of the same name, restoring it against a
 * pattern it was never inserted from and writing an id the author never wrote.
 *
 * Through the shared walk rather than a traversal of this module's own, which
 * is what makes the cycle, the non-node entry and the node budget somebody
 * else's already-solved problem. It relies on that walk visiting a parent
 * before its children, which is what lets one pass carry the scope down.
 */
function renameScopes(
  nodes: readonly BlockNode[],
  limits: DocumentLimits
): ReadonlyMap<BlockNode, RenameScope> | undefined {
  const scopes = new Map<BlockNode, RenameScope>();
  // Which recorded renames still apply depends on the WHOLE document — a node
  // a record lists may sit anywhere, or twice — so it is gathered on this walk,
  // which already reaches every node under the same bound, and applied after.
  const occurrences = occurrenceIndex();
  const seen = new Set<BlockNode>();
  // One reading per node OBJECT, not one per visit. A node placed in two slots
  // is reached twice, and a stored node can be a Proxy whose reflection answers
  // differently each time — so reading again would let one node be a scope
  // boundary on one occurrence and not on the other, and carry two different
  // rename maps. Which of them its descendants inherited would then depend on
  // walk order.
  const readings = new Map<BlockNode, NodeOrigin>();
  let overCap = false;
  const ownOf = (node: BlockNode): NodeOrigin => {
    const known = readings.get(node);
    if (known !== undefined) return known;
    const read = nodeOrigin(node);
    readings.set(node, read);
    return read;
  };
  // BOUNDED, because the shared walk counts a node object placed in two slots
  // as two elements — deliberately, since counting it once reports half a real
  // size. A document whose branches share objects is therefore exponential in
  // its own depth: measured, nineteen distinct objects each holding the next
  // twice walk as 524,287 entries, and a few dozen would not finish. That is a
  // property of the walk rather than of this scan, but this scan is what made
  // it reachable from a save whose selection is somewhere else entirely.
  //
  // `maxNodes + 1`, so reading the last one is proof there are more than the
  // cap rather than proof the document ends exactly at it.
  //
  // Through the PUBLISHED limit rule, not a comparison of this file's own. A
  // `NaN` cap fails in the silent direction: `NaN + 1` is `NaN`, every
  // `read >= NaN` is false, and the budget is REMOVED rather than exceeded — so
  // the exponential walk this bound exists to stop runs in full, before the
  // caller's configuration is rejected anywhere else. `boundedLimit` already
  // refuses that, and admits `Infinity`, which is the supported way to ask for
  // no cap at all.
  const cap = boundedLimit(limits.maxNodes, "maxNodes", "renameScopes");
  walkNodes(
    [...nodes],
    (node, parent) => {
      occurrences.note(node);
      // A node carrying provenance of its OWN is where inheritance stops, and the
      // test is the RECORD rather than the size of its map. An insert that
      // renamed nothing writes no `renamed` at all — the ordinary case, since a
      // collision is the exception — so a boundary derived from a non-empty map
      // lets a nested pattern inherit its host's renames and store its own
      // content under the host pattern's spelling.
      //
      // ANY record at all, whatever it says and whether or not it can be read.
      // The question here is not what a record CONTAINS — it is whether this node
      // is somewhere the ancestor's rename is about, and a node claiming
      // provenance of its own is not. A component detached inside an inserted
      // pattern carries `{ from: "component" }`; a stored record can be malformed
      // or refuse to be read at all. None of those came from the host pattern, so
      // none of them should inherit its renames — and only a whole pattern record
      // supplies a map, so every other case stops inheritance with an empty one.
      //
      // The test is for what BOUNDS the scope, not for what CARRIES the data: a
      // record's contents decide what can be put back, and its PRESENCE decides
      // whether this node is somewhere the ancestor's rename is about at all.
      //
      // The untrusted case is UNREACHABLE from here today and the test is kept
      // anyway: a selection holding a malformed record is refused by the shape
      // rule as `invalid-node` long before a scope is decided, which is asserted
      // below. Unreachability is a property of the current call graph rather than
      // of this function, and one descriptor read is cheap enough that not
      // depending on that ordering costs nothing.
      //
      // The map is remembered rather than rebuilt, so a node reached twice keeps
      // one scope object. `answerOf` memoises its inverse per map object, so a
      // rebuilt equal map is a second cache entry for an answer already computed.
      const own = ownOf(node);
      if (own.claims) {
        scopes.set(node, scopes.get(node) ?? scopeOf(own.origin));
        return;
      }

      const inherited = parent === undefined ? undefined : scopes.get(parent);
      if (seen.has(node)) {
        // The same node OBJECT reached a second time, under a different parent.
        // A selection names objects, not places, so nothing downstream can say
        // which occurrence was meant — and restoring against the wrong one
        // rewrites ids the author wrote. Declining leaves every id alone, which
        // is what a node with no record in scope gets anyway.
        //
        // Compared by what the two scopes SAY, not by which map object they are.
        // Two inserted roots carry two copies of one record, so equal maps are
        // the ordinary case for a node reached under both — and there is no
        // ambiguity to decline when both occurrences give the same answer.
        if (!sameScope(scopes.get(node), inherited)) {
          scopes.set(node, NO_SCOPE);
        }
        return;
      }
      seen.add(node);
      if (inherited !== undefined) scopes.set(node, inherited);
    },
    {
      maxNodes: cap + 1,
      onBudgetSpent: () => {
        overCap = true;
      },
    }
  );
  // NOTHING rather than what was gathered. A scope decided from a partial walk
  // is a scope whose nearest claiming ancestor may simply not have been reached
  // — so it would restore an id against the wrong record, silently, on a
  // document the engine already refuses to store.
  if (overCap) return undefined;
  for (const [node, scope] of scopes) {
    scopes.set(node, occurrences.liveScope(scope));
  }
  return scopes;
}

/**
 * Whether two scopes give the same answer for every id and every node.
 *
 * Content and not identity, for the reason {@link sameRenames} gives — and the
 * node lists too, since two records renaming alike can have renamed different
 * nodes.
 */
function sameScope(
  one: RenameScope | undefined,
  other: RenameScope | undefined
): boolean {
  if (one === other) return true;
  if (one === undefined || other === undefined) return false;
  return (
    sameRenames(one.renames, other.renames) &&
    sameCarriers(one.carriers, other.carriers)
  );
}

function sameCarriers(
  one: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  other: ReadonlyMap<string, ReadonlySet<string>> | undefined
): boolean {
  if (one === other) return true;
  if (one === undefined || other === undefined) return false;
  if (one.size !== other.size) return false;
  for (const [now, ids] of one) {
    if (!sameNodeIds(ids, other.get(now))) return false;
  }
  return true;
}

/** Whether two node lists name exactly the same nodes. */
function sameNodeIds(
  one: ReadonlySet<string>,
  other: ReadonlySet<string> | undefined
): boolean {
  if (other === undefined || other.size !== one.size) return false;
  for (const id of one) if (!other.has(id)) return false;
  return true;
}

/**
 * Whether two scopes give the same answer for every id.
 *
 * Content and not identity. A record is copied onto each root an insert placed,
 * so two roots governed by one insert hold two equal maps rather than one — and
 * a node reached under both is not ambiguous, it is told the same thing twice.
 */
function sameRenames(
  one: ReadonlyMap<string, string> | undefined,
  other: ReadonlyMap<string, string> | undefined
): boolean {
  if (one === other) return true;
  if (one === undefined || other === undefined) return false;
  if (one.size !== other.size) return false;
  for (const [was, now] of one) {
    if (other.get(was) !== now) return false;
  }
  return true;
}

/**
 * The scope of a node whose own is unknowable, and of one that inherits none.
 *
 * A shared empty map rather than a fresh one per node, because it is the
 * ordinary case — a collision is the exception, so most inserts rename nothing
 * — and because `answerOf` memoises its inverse per map OBJECT. One map here is
 * one cache entry for the whole document; a fresh one per node would be an
 * allocation and a cache entry each, for the same empty answer.
 */
const NO_RENAMES: ReadonlyMap<string, string> = new Map();

/** The scope of a node with no record in reach, shared for the same reason. */
const NO_SCOPE: RenameScope = { renames: NO_RENAMES, carriers: undefined };
