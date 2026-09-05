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
import { lockedWithin, type BuilderOp, type OpPosition } from "./ops";
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
  | "dom-id-collision";

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
  const refusal = refusedAtRoot(selected, nesting);
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
 * The first selected block that cannot stand at a document root, if any.
 *
 * Saving a run lifts it OUT of whatever contained it: the pattern document's
 * roots are the selected blocks themselves. A block declaring which parents it
 * may sit in has just lost the only one it had, and the store validates root
 * placement through the same rule — so without this the planner reports success
 * and hands back a document the create then refuses. Selecting a `core/column`
 * inside a `core/columns` is the ordinary way to reach it, not a corner case.
 *
 * Asked of the SHARED rule rather than answered here. The canvas, the validator
 * and this planner have to agree about where a block may sit, and a second
 * implementation would agree only until one of them changed.
 */
function refusedAtRoot(
  selected: readonly BlockNode[],
  nesting: NestingSource
): PlanRefusal | undefined {
  for (const node of selected) {
    const verdict = canBeRoot(node.type, nesting);
    if (verdict.allowed) continue;
    return {
      problem: "restricted-at-root",
      ...(verdict.permitted === undefined
        ? {}
        : { permitted: verdict.permitted }),
    };
  }
  return undefined;
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
 * Provenance is NOT recorded on the inserted roots. Design Q12 proposes an inert
 * `origin: { pattern, digest }` so "upstream changed" is answerable later, but
 * `origin` is not one of the frozen `keyof BlockNode` keys, so recording it is a
 * change to the stored format rather than an additive field —
 * `decision:pb6-q12-provenance-on-copies` is with the founder.
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
    placementRefusal(copy.nodes, destination.place, nesting) ??
    lockRefusal(copy.nodes, "locked") ??
    // The `"document"` target REMOVES what is there, and a remove refuses a
    // locked subtree for the same reason an insert refuses one — so replacing a
    // page that holds a locked block throws at apply time unless it is caught
    // here. Only that target deletes anything; a positional insert adds.
    (target === "document"
      ? lockRefusal(document.nodes, "destination-locked")
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
  readonly parentType?: string;
  readonly slot?: string;
}

function destinationOf(
  document: BlockDocument,
  target: InsertTarget
): Destination | PlanRefusal {
  if (target === "document") return { place: { at: null } };
  if (target.parentId === undefined) return { place: { at: target } };

  // Uniqueness FIRST, then the lookup. `applyOp` refuses an insert whose
  // destination id is held twice, and a find that answers with the first of two
  // would describe a different container than the one the author aimed at.
  if (countById(document.nodes, target.parentId) !== 1) {
    return { problem: "duplicate-destination" };
  }
  const parent = findNode(document.nodes, target.parentId);
  if (parent === undefined) return { problem: "unknown" };
  return {
    place: { at: target, parentType: parent.type, slot: target.slot },
  };
}

/** How many nodes in a forest carry one id. */
function countById(nodes: BlockNode[], id: string): number {
  let seen = 0;
  walkNodes(nodes, node => {
    if (node.id === id) seen += 1;
  });
  return seen;
}

/** The first root that may not sit where it is being put, phrased as a refusal. */
function placementRefusal(
  roots: readonly BlockNode[],
  place: Placement,
  nesting: NestingSource
): PlanRefusal | undefined {
  for (const root of roots) {
    const verdict =
      place.parentType === undefined || place.slot === undefined
        ? canBeRoot(root.type, nesting)
        : bothHalves(root.type, place.parentType, place.slot, nesting);
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
 * NOT covered by a test, and deliberately so: the suffix comes from a freshly
 * minted UUID, so no test can arrange for the destination to hold the string
 * that is about to be drawn. A test asserting the refusal would be one that
 * cannot fail. The property this protects IS covered — inserting one pattern
 * twice into one page and finding no repeated DOM id.
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

/** Every DOM id the destination already carries, from either spelling. */
function domIdsIn(nodes: BlockNode[]): Set<string> {
  const taken = new Set<string>();
  walkNodes(nodes, node => {
    if (typeof node.cssId === "string" && node.cssId !== "")
      taken.add(node.cssId);
    const attribute = node.attributes?.id;
    if (typeof attribute === "string" && attribute !== "") taken.add(attribute);
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
