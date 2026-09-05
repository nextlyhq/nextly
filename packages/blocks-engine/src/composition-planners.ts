/**
 * Turning a selection into a saved, reusable document — planned, not performed.
 *
 * Each planner is PURE. It reads a document and answers with two things: the
 * library row to create, and the ops the page needs. It writes nothing, mints
 * no request and knows no collection: the caller supplies the slug it stores
 * under and the metadata fields that collection declares.
 *
 * ## Why the plan is split from the doing
 *
 * Saving a selection is two writes in two collections, and the failure mode is
 * documented in the design (Elementor #36049): the library row is created, the
 * page edit fails, and an author is left with a pattern nothing points at.
 * Splitting the decision from the execution is what lets the caller wrap both
 * in one unit of work, roll the create back when the page ops fail, and offer
 * the same action as a dry run — the plan IS the dry run, so what a preview
 * shows and what a real save applies cannot differ.
 *
 * It is also what lets an editor, a plugin route and an agent share one answer.
 * A planner takes a document and returns data, so nothing here needs React, a
 * request or a database, and the editor's "Save as pattern" and the API's are
 * the same function rather than two implementations that agree until one moves.
 *
 * @module composition-planners
 */
import type { BlockDocument, BlockNode } from "./document";
import {
  canBeRoot,
  canNest,
  canNestInSlot,
  type NestingRefusal,
  type NestingSource,
  type NestingVerdict,
} from "./nesting";
import {
  lockedWithin,
  nodeShapeRefusal,
  positionRefusal,
  type BuilderOp,
  type OpPosition,
} from "./ops";
import { contiguousRun, type RunProblem } from "./sibling-run";
import { findNode, reidForestWithMap, walkNodes } from "./tree";

/** A library row a planner asks the caller to create. */
export interface PlannedCreate<TFields> {
  /**
   * The collection slug to create it in.
   *
   * Supplied by the caller and echoed back rather than decided here. The three
   * composition stores are the page-builder plugin's, and a host may not have
   * installed it — an engine that named `"patterns"` would be asserting a
   * collection exists that it cannot see.
   */
  readonly collection: string;
  /** The document to store, with its own ids. */
  readonly document: BlockDocument;
  /** The collection's own metadata fields, passed through untouched. */
  readonly fields: TFields;
}

/** What a composition action would create, and what it would do to the page. */
export interface CompositionPlan<TFields> {
  /** The row to create, absent for an action that only edits the page. */
  readonly create?: PlannedCreate<TFields>;
  /**
   * The edits to apply to the page, in order, as one atomic group.
   *
   * Empty is a legitimate plan, not a missing one: saving a selection to the
   * library leaves the page exactly as it was.
   */
  readonly pageOps: readonly BuilderOp[];
  readonly problem?: undefined;
  // Declared on the success member too, so a caller reads either field off the
  // union without narrowing first and cannot read a refusal's detail off a plan.
  readonly permitted?: undefined;
}

/**
 * A plan, or the cause there is none.
 *
 * Carries the cause from {@link contiguousRun} unchanged, so the sentence shown
 * to an author is composed once per surface rather than once per planner.
 */
/**
 * Why a composition action cannot be planned.
 *
 * The selection causes come from {@link contiguousRun} unchanged. The nesting
 * one is this layer's own: a run lifted out of a container becomes the ROOTS of
 * a new document, and a block that declares which parents it may sit in cannot
 * be one.
 */
export type PlanProblem =
  | RunProblem
  | NestingRefusal
  /** The document handed in is not a pattern. */
  | "not-a-pattern"
  /** The destination id is held by more than one node. */
  | "duplicate-destination"
  /** The pattern holds a locked node, which the op layer will not insert. */
  | "locked"
  /**
   * Replacing the document would delete a locked block already on the page.
   *
   * Told apart from `"locked"` because the two are different blocks and only
   * one of them is the author's to unlock here: one is inside the pattern being
   * placed, the other is on the page in front of them.
   */
  | "destination-locked"
  /** A minted DOM id keeps colliding with one the destination already holds. */
  | "dom-id-collision"
  /** The position names nowhere the op layer would accept. */
  | "invalid-position"
  /** The stored pattern holds a node the op layer will not carry. */
  | "invalid-node"
  /** The stored pattern spells one rendered id on two of its own nodes. */
  | "duplicate-dom-id";

/** A refusal, with whatever the surface needs to phrase it. */
export interface PlanRefusal {
  readonly problem: PlanProblem;
  /**
   * For `"restricted-at-root"`: the parents the refused block requires.
   *
   * Carried rather than left to be looked up, because the caller is the only
   * place that still knows which selection was refused — the same reason
   * `NestingVerdict` carries it.
   */
  readonly permitted?: readonly string[];
  readonly create?: undefined;
  readonly pageOps?: undefined;
}

export type PlanResult<TFields> = CompositionPlan<TFields> | PlanRefusal;

/** Where a saved selection is stored, in the caller's vocabulary. */
export interface PatternTarget<TFields> {
  readonly collection: string;
  readonly fields: TFields;
}

/**
 * Save a contiguous run of blocks as a pattern.
 *
 * **The page is not touched.** A pattern is copy-on-insert and keeps no link
 * back, so saving one takes a copy and leaves the original where it is —
 * `pageOps` is empty, and that is the whole behavioural difference from
 * `planConvertToComponent`, which replaces the run with a linked instance.
 *
 * **The copy gets fresh ids.** It would render correctly without them, because
 * insert re-identifies anyway; storing the page's ids would still be wrong. A
 * node id is how everything in this system addresses a node — styles, locale
 * overlays, the class-usage record, editor history — so two stored documents
 * claiming one id makes any index keyed on it unable to say which node it
 * describes. Re-identifying at SAVE removes the ambiguity where it is created
 * rather than relying on every later reader to disambiguate.
 *
 * The roots are re-identified TOGETHER: see {@link reidForestWithMap} for why
 * doing them one at a time silently breaks a reference that crosses from one
 * root to the next.
 *
 * **`settings` is not copied.** Document settings are page-scoped by
 * definition — a background with no owning node, and the document's custom CSS
 * — so a pattern that carried them would repaint every page it was inserted
 * into. Node styles live on the nodes and travel with them.
 *
 * **`assets` is not synthesised.** The media index describes a whole document,
 * and which prop of a block holds a media id is a property of that block's
 * definition, which the engine cannot read — the same boundary that stops the
 * id remapper reaching into props. A partial index would be worse than none,
 * since absence is what a reference check reads as "not used".
 */
export function planSaveAsPattern<TFields>(
  document: BlockDocument,
  selectedIds: readonly string[],
  target: PatternTarget<TFields>,
  nesting: NestingSource
): PlanResult<TFields> {
  const result = contiguousRun(document.nodes, selectedIds);
  if (result.run === undefined) return { problem: result.problem };

  const selected = result.run.places.map(place => place.node);
  // Saving LIFTS the run out, so its blocks become document roots — the same
  // question an insert asks, asked of the same rule.
  const refusal = placementRefusal(selected, { kind: "root" }, nesting);
  if (refusal !== undefined) return refusal;

  return {
    create: {
      collection: target.collection,
      document: {
        // The SOURCE document's version, not the current one. These nodes are
        // written in the format the page holds them in, and a pattern that
        // claimed the newest version would tell the migrator there is nothing
        // to do — so an old page's blocks would be stored as if already
        // migrated and never brought forward.
        formatVersion: document.formatVersion,
        kind: "pattern",
        nodes: reidForestWithMap(selected).nodes,
      },
      fields: target.fields,
    },
    pageOps: [],
  };
}

/**
 * Where a block is being put, in the terms the nesting rule judges.
 *
 * A closed pair rather than a nullable parent, for the reason `canBeRoot` is a
 * separate function from `canNest`: a parent variable that is accidentally
 * undefined would otherwise turn a lookup that failed into a confident verdict
 * about the root.
 */
export type PlacementTarget =
  | { readonly kind: "root" }
  | {
      readonly kind: "slot";
      readonly parentType: string;
      readonly slot: string;
    };

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
function placementRefusal(
  blocks: readonly BlockNode[],
  where: PlacementTarget,
  nesting: NestingSource
): PlanRefusal | undefined {
  for (const block of blocks) {
    const verdict =
      where.kind === "root"
        ? canBeRoot(block.type, nesting)
        : bothHalves(block.type, where.parentType, where.slot, nesting);
    if (verdict.allowed) continue;
    return {
      problem: verdict.reason,
      ...(verdict.permitted === undefined
        ? {}
        : { permitted: verdict.permitted }),
    };
  }
  return undefined;
}

/**
 * Both halves of the nesting rule, in the order that reports the more
 * actionable refusal first.
 *
 * The child naming its permitted parents is the sharper answer — it names
 * somewhere the block CAN go — where a slot's allow-list only says this one
 * will not have it.
 */
function bothHalves(
  childType: string,
  parentType: string,
  slot: string,
  nesting: NestingSource
): NestingVerdict {
  const child = canNest(childType, parentType, nesting);
  return child.allowed
    ? canNestInSlot(childType, parentType, slot, nesting)
    : child;
}

/**
 * Where an inserted pattern goes: a position, or the document itself.
 *
 * `"document"` is not a position and is deliberately not spelled as one. It
 * replaces the root forest — a full-page pattern IS a page layout, and the
 * builder offers it from an empty document as "start from a pattern" — and no
 * `OpPosition` can express "instead of everything that is there".
 */
export type InsertTarget = OpPosition | "document";

/**
 * Insert a saved pattern, as a copy that keeps no link back.
 *
 * **Everything gets fresh ids.** A pattern may be inserted twice into one page,
 * and the stored copy carries whatever ids it was saved with, so placing it as
 * it stands would put two nodes with one id in a document — which the op layer
 * refuses and every id-keyed reader would misread. The roots are re-identified
 * TOGETHER so a reference crossing from one root to the next follows the copy.
 *
 * **`settings` is the destination's.** A pattern carries no document settings —
 * they describe a page, not a run — and the `"document"` target replaces the
 * root forest without touching them, so a full-page pattern does not repaint the
 * page it is starting.
 *
 * ## What it refuses, and why a planner refuses it rather than the apply
 *
 * The plan IS the dry run. A plan that reports success and then throws when it
 * is applied defeats the reason planning is separate from doing, so every
 * refusal the op layer will make that can be foreseen is made here:
 *
 * - a block that may not sit where it is being put, asked of the SHARED nesting
 *   rule, both halves of it — the child naming its permitted parents and the
 *   slot naming what it admits;
 * - a subtree arriving LOCKED, which `applyOp` refuses because the inverse of an
 *   insert is a remove and a remove refuses a locked subtree, so the insert
 *   could never be undone;
 * - a destination parent id the document holds twice, which `applyOp` refuses
 *   because the incoming node would be placed under both.
 *
 * The one refusal left to the apply is the machine cap on depth and size, which
 * depends on limits the caller passes there.
 *
 * Nothing records where the copy came from. A pattern is copy-on-insert and
 * keeps no link back, so the inserted nodes are ordinary content from the
 * moment they land.
 */
export function planInsertPattern(
  document: BlockDocument,
  pattern: BlockDocument,
  target: InsertTarget,
  nesting: NestingSource
): PlanResult<never> {
  if (pattern.kind !== "pattern") return { problem: "not-a-pattern" };
  if (pattern.nodes.length === 0) return { problem: "empty" };

  const destination = destinationOf(document, target);
  if (destination.problem !== undefined) return destination;

  const copy = freshCopy(pattern.nodes, document);
  if (copy.problem !== undefined) return copy;

  const refusal =
    // The op layer's own shape rule, asked before the plan exists. A STORED
    // pattern can hold a node that type-checks and is still structurally
    // invalid — `version: 0` — and the insert would throw on it.
    shapeRefusal(copy.nodes) ??
    duplicateDomIdRefusal(copy.nodes) ??
    placementRefusal(copy.nodes, destination.place.where, nesting) ??
    lockRefusal(copy.nodes, "locked") ??
    // The `"document"` target REMOVES what is there, and a remove refuses a
    // locked subtree for the same reason an insert refuses one — so replacing a
    // page that holds a locked block throws at apply time unless it is caught
    // here. Only that target deletes anything; a positional insert adds.
    (target === "document"
      ? (lockRefusal(document.nodes, "destination-locked") ??
        // A remove asks the same shape question an insert does, so replacing a
        // page holding a malformed node throws unless it is caught here.
        shapeRefusal(document.nodes))
      : undefined);
  if (refusal !== undefined) return refusal;

  return {
    pageOps: insertOps(copy.nodes, destination.place, document, target),
  };
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
interface Placement {
  readonly at: OpPosition | null;
  readonly where: PlacementTarget;
}

function destinationOf(
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
  return {
    place: {
      at: target,
      where: { kind: "slot", parentType: parent.type, slot: target.slot },
    },
  };
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
function countById(nodes: BlockNode[], id: string): number {
  let seen = 0;
  walkNodes(nodes, node => {
    if (node.id === id) seen += 1;
  });
  return seen;
}

/** The first root the op layer would refuse to carry, phrased as a refusal. */
function shapeRefusal(roots: readonly BlockNode[]): PlanRefusal | undefined {
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
function duplicateDomIdRefusal(
  roots: readonly BlockNode[]
): PlanRefusal | undefined {
  const seen = new Set<string>();
  let repeated = false;
  walkNodes([...roots], node => {
    if (repeated) return;
    for (const id of domIdsOf(node)) {
      if (seen.has(id)) {
        repeated = true;
        return;
      }
      seen.add(id);
    }
  });
  return repeated ? { problem: "duplicate-dom-id" } : undefined;
}

/** Every DOM id one node carries, from either spelling. */
function domIdsOf(node: BlockNode): string[] {
  const ids: string[] = [];
  if (typeof node.cssId === "string" && node.cssId !== "") ids.push(node.cssId);
  for (const [name, value] of Object.entries(node.attributes ?? {})) {
    if (name.toLowerCase() !== "id") continue;
    if (typeof value === "string" && value !== "") ids.push(value);
  }
  return ids;
}

/** A locked node anywhere in a forest, phrased as the caller's own refusal. */
function lockRefusal(
  roots: readonly BlockNode[],
  problem: "locked" | "destination-locked"
): PlanRefusal | undefined {
  for (const root of roots) {
    if (lockedWithin(root) !== undefined) return { problem };
  }
  return undefined;
}

/** A re-identified copy, or the reason one could not be made. */
interface FreshCopy {
  readonly nodes: BlockNode[];
  readonly problem?: undefined;
}

/**
 * How many times a fresh set of ids may be minted before giving up.
 *
 * `reidForestWithMap` guarantees its DOM ids are unique WITHIN the copy and
 * says so — it is handed a forest and cannot see the page. A minted id is
 * derived from a fresh random node id, so colliding with one the destination
 * already carries needs that exact string to be there already; minting again
 * draws different ids, so one retry all but settles it and three is a bound
 * rather than an expectation.
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
 * The property that IS covered, deterministically, is the one that matters in
 * practice: inserting one pattern twice into one page and finding no repeated
 * DOM id anywhere in the result.
 */
const MAX_ID_MINTING_ATTEMPTS = 3;

function freshCopy(
  roots: BlockNode[],
  document: BlockDocument
): FreshCopy | PlanRefusal {
  const taken = domIdsIn(document.nodes);
  for (let attempt = 0; attempt < MAX_ID_MINTING_ATTEMPTS; attempt += 1) {
    const minted = reidForestWithMap(roots);
    const clash = [...minted.domIds.values()].some(id => taken.has(id));
    if (!clash) return { nodes: minted.nodes };
  }
  return { problem: "dom-id-collision" };
}

/**
 * Every DOM id the destination already carries, from either spelling.
 *
 * Attribute names are FOLDED. HTML attribute names are case-insensitive, and
 * the copier that mints replacements folds them too, so a destination storing
 * `ID` is holding a DOM id as surely as one storing `id` — and an exact-case
 * read here would not see it. Unreachable in a test for the reason
 * {@link MAX_ID_MINTING_ATTEMPTS} gives, and correct for a reason that does not
 * depend on being reachable: this set is a claim about what the page holds, and
 * a claim that is wrong about half the spellings is wrong.
 */
function domIdsIn(nodes: BlockNode[]): Set<string> {
  const taken = new Set<string>();
  walkNodes(nodes, node => {
    if (typeof node.cssId === "string" && node.cssId !== "")
      taken.add(node.cssId);
    // FOLDED, because HTML attribute names are case-insensitive and the copier
    // that mints replacements folds them too (`key.toLowerCase() === "id"`). An
    // exact-case read here would miss a destination storing `ID`, and the miss
    // is silent: the collision check passes and the page ends up with two
    // elements answering to one id.
    for (const [name, value] of Object.entries(node.attributes ?? {})) {
      if (name.toLowerCase() !== "id") continue;
      if (typeof value === "string" && value !== "") taken.add(value);
    }
  });
  return taken;
}

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
 */
function insertOps(
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
  roots.forEach((node, offset) => {
    const at: OpPosition =
      place.at === null || place.at.parentId === undefined
        ? { index: start + offset }
        : {
            parentId: place.at.parentId,
            slot: place.at.slot,
            index: start + offset,
          };
    ops.push({ kind: "insert", node, at });
  });
  return ops;
}
