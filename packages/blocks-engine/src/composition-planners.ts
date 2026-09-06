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
import { renderedDomId } from "./document";
import type { BlockDocument, BlockNode, BlockOrigin } from "./document";
import {
  canBeRoot,
  canNest,
  canNestInSlot,
  type NestingRefusal,
  type NestingSource,
  type NestingVerdict,
} from "./nesting";
import {
  documentRefusal,
  forestRefusal,
  lockedWithin,
  nodeShapeRefusal,
  positionRefusal,
  type BuilderOp,
  type OpPosition,
} from "./ops";
import { patternDigest } from "./pattern-digest";
import { contiguousRun, type RunProblem } from "./sibling-run";
import { findNode, mapForest, reidForestWithMap, walkNodes } from "./tree";

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

/**
 * A library row a planner asks the caller to OVERWRITE.
 *
 * The document only. A save-over replaces a pattern's tree with the selection
 * that was saved onto it, and the row's metadata — its name, its description,
 * whatever the collection declares — belongs to the library entry rather than
 * to the run. Carrying `fields` here would make "update from selection" also
 * rename the pattern, silently, from whatever the caller happened to pass.
 *
 * The collection slug is the caller's, echoed back for the reason
 * {@link PlannedCreate} gives: the composition stores belong to the
 * page-builder plugin, and an engine naming one would assert a collection
 * exists that it cannot see.
 */
export interface PlannedUpdate {
  readonly collection: string;
  /** The entry to overwrite. */
  readonly id: string;
  /** The document to store in its place. */
  readonly document: BlockDocument;
}

/** What a composition action would create, and what it would do to the page. */
export interface CompositionPlan<TFields> {
  /** The row to create, absent for an action that only edits the page. */
  readonly create?: PlannedCreate<TFields>;
  /**
   * The row to overwrite, absent for an action that creates one or none.
   *
   * A separate field rather than a `create` carrying an optional id, because
   * the two are different writes with different failure modes — a create can
   * be rolled back by deleting what it made, where an overwrite can only be
   * rolled back by something that read the prior document first. A caller
   * sequencing the unit of work has to tell them apart, and a nullable id is
   * the shape that lets it forget to.
   */
  readonly update?: PlannedUpdate;
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
  | "duplicate-dom-id"
  /** One of the documents cannot be edited at all, whatever the ops say. */
  | "unusable-document"
  /** The pattern was handed over without an identity to record. */
  | "invalid-source";

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
  readonly update?: undefined;
  readonly pageOps?: undefined;
}

export type PlanResult<TFields> = CompositionPlan<TFields> | PlanRefusal;

/** Where a saved selection is stored, in the caller's vocabulary. */
export interface PatternTarget<TFields> {
  readonly collection: string;
  readonly fields: TFields;
}

/**
 * Which stored pattern a save-over replaces, in the caller's vocabulary.
 *
 * No fields, and no document. Not fields, because the row's metadata is not
 * the run's to rewrite — see {@link PlannedUpdate}. Not the document, because
 * a save-over reads nothing of what is being replaced: it writes the selection
 * over it, and the digest it records is taken from what it stores. Asking for
 * the prior document would invite a caller to pass one fetched at a different
 * moment than the write lands.
 */
export interface PatternUpdateTarget {
  readonly collection: string;
  /** The pattern entry to overwrite. */
  readonly id: string;
}

/**
 * Save a contiguous run of blocks as a pattern.
 *
 * **The page is not touched.** A pattern is copy-on-insert and keeps no link
 * back, so saving one takes a copy and leaves the original where it is —
 * `pageOps` is empty, and that is the whole behavioural difference from
 * `planConvertToComponent`, which replaces the run with a linked instance.
 *
 * **What it stores** — fresh ids, kept DOM ids, no inherited provenance, no
 * `settings`, and the source document's format version — is
 * {@link savedPatternDocument}, shared with the save-over planner so the two
 * cannot produce different documents from one selection.
 *
 * **It refuses what INSERTING the result would refuse.** A selection that is
 * not one contiguous run, a block that may not be a document root, a node
 * whose shape the op layer will not carry, a descendant nested somewhere the
 * rules no longer allow, one DOM id spelled on two of the run's own nodes, and
 * a format version no apply accepts. Each of those can sit in a page that
 * renders, because pages are saved under forgiving validation and the rules
 * move underneath them — and each would otherwise become a library entry an
 * author can see, cannot place anywhere, and gets no reason for until they
 * try. {@link savableRun} carries the reasoning; the causes arrive on
 * {@link PlanRefusal}.
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
  const saved = plannedSave(document, selectedIds, nesting);
  if (saved.problem !== undefined) return saved;

  return {
    create: {
      collection: target.collection,
      document: saved.stored,
      fields: target.fields,
    },
    pageOps: [],
  };
}

/** A selection, validated, and the pattern document it becomes. */
interface PlannedSave {
  readonly selected: readonly BlockNode[];
  readonly stored: BlockDocument;
  readonly problem?: undefined;
  readonly permitted?: undefined;
}

/**
 * Everything a SAVE decides before it knows which kind of save it is.
 *
 * Both planners call only this. They differ in what they do with the answer —
 * one asks for a row to be created, the other for one to be replaced and the
 * page's provenance repaired — and in nothing before it. Keeping the shared
 * part a single call rather than a pair of them is what stops the two drifting
 * a step apart: an ordering, or one question asked in one place, is exactly the
 * kind of difference that survives review because each planner reads correctly
 * on its own.
 */
function plannedSave(
  document: BlockDocument,
  selectedIds: readonly string[],
  nesting: NestingSource
): PlannedSave | PlanRefusal {
  const run = savableRun(document, selectedIds, nesting);
  if (run.problem !== undefined) return run;

  const stored = savedPatternDocument(document, run.selected);
  if (stored.problem !== undefined) return stored;

  return { selected: run.selected, stored: stored.document };
}

/** The pattern document a save would store, or why it could not. */
interface SavedPattern {
  readonly document: BlockDocument;
  readonly problem?: undefined;
  readonly permitted?: undefined;
}

/** A selection that may be lifted into a document of its own. */
interface SavableRun {
  readonly selected: readonly BlockNode[];
  readonly problem?: undefined;
  readonly permitted?: undefined;
}

/**
 * The one question every SAVE asks of a selection.
 *
 * Both save planners ask it and they must ask it identically: an author who can
 * save a run as a new pattern must be able to save the same run over an
 * existing one, and a rule spelled twice is a rule that will eventually differ
 * between the two menu items sitting next to each other.
 *
 * The blocks must be one contiguous run of siblings — the cause comes back from
 * {@link contiguousRun} unchanged, so the sentence an author reads is composed
 * once per surface rather than once per planner. And saving LIFTS that run out,
 * so its blocks become the ROOTS of a new document, which a block declaring the
 * parents it may sit in cannot be.
 *
 * ## It also asks what INSERT will ask of the result
 *
 * A page is stored under forgiving validation and the rules move underneath it,
 * so a run that renders today can hold a node no insert would carry: one whose
 * shape the op layer refuses, or a descendant whose parent or slot rule
 * narrowed after the page was written. Saving such a run without complaint
 * produces a library row that `planInsertPattern` then refuses EVERYWHERE — an
 * entry an author can see, cannot place, and gets no reason for until they try.
 *
 * That failure has happened once already in this module, between save and
 * insert, and it is invisible in either planner read alone: each answers
 * correctly about the document it was handed. So the save asks the questions
 * the insert will ask, of the same shared rules, and refuses at the point where
 * the author still has the selection in front of them.
 *
 * The shape check is also what keeps this function from THROWING. Copying a
 * selection runs `structuredClone`, which raises a native `DOMException` on a
 * value JSON cannot carry — a function that reached `props` from an in-process
 * caller — rather than the refusal this module promises. Asking first turns
 * that crash into a cause, which is why the insert path asks it before copying
 * too.
 *
 * The duplicate-DOM-id question is asked of the SELECTION and not of the page.
 * A page may legitimately spell one id twice elsewhere — that is a warning
 * under the forgiving validation pages are saved with, not a refusal — and it
 * is no reason to stop an author saving a run that does not. What is refused is
 * a run carrying the duplicate INTO a pattern, where insert would meet it.
 *
 * Refused rather than repaired, for the reason {@link duplicateDomIdRefusal}
 * gives: renaming one of the pair silently changes which element an anchor
 * reaches, and nothing here knows which of them the author meant.
 */
function savableRun(
  document: BlockDocument,
  selectedIds: readonly string[],
  nesting: NestingSource
): SavableRun | PlanRefusal {
  const result = contiguousRun(document.nodes, selectedIds);
  if (result.run === undefined) return { problem: result.problem };

  const selected = result.run.places.map(place => place.node);
  const refusal =
    shapeRefusal(selected) ??
    duplicateDomIdRefusal(selected) ??
    placementRefusal(selected, { kind: "root" }, nesting) ??
    internalNestingRefusal(selected, nesting);
  return refusal ?? { selected };
}

/**
 * The pattern document a selection becomes, for every planner that stores one.
 *
 * ONE implementation, because save-as and save-over must produce the identical
 * document from the identical selection. They do not merely resemble each
 * other: an author inserts a pattern, edits it, and saves it back over the
 * source, and the digest that says whether the copy is in sync is taken over
 * what this returns. Two builders that agreed today would make that comparison
 * report a change nobody made the day one of them moved.
 *
 * **The SOURCE document's format version, not the current one.** These nodes
 * are written in the format the page holds them in, and a pattern that claimed
 * the newest version would tell the migrator there is nothing to do — so an old
 * page's blocks would be stored as if already migrated and never brought
 * forward.
 *
 * **Fresh ids.** A node id is how everything in this system addresses a node —
 * styles, locale overlays, the class-usage record, editor history — so two
 * stored documents claiming one id makes any index keyed on it unable to say
 * which node it describes. The roots are re-identified TOGETHER: see
 * {@link reidForestWithMap} for why doing them one at a time silently breaks a
 * reference that crosses from one root to the next.
 *
 * **DOM ids are KEPT.** A saved run becomes a document of its own rather than a
 * copy placed beside its original, so there is no collision to avoid — and an
 * insert renames only what its own destination already holds. Minting here
 * would store a `hero-3ee4a0d4` no author wrote, make two saves of one
 * selection differ so any content fingerprint reported a change nobody made,
 * and grow the id by nine characters on every save-insert-save cycle without
 * bound. `reidForestWithMap` takes the policy
 * that says which, and its `DomIdPolicy` carries the measurements.
 *
 * **No inherited provenance.** These nodes came from the page, not from
 * wherever the page's nodes came from.
 *
 * **No `settings`.** Document settings are page-scoped by definition — a
 * background with no owning node, and the document's custom CSS — so a pattern
 * that carried them would repaint every page it was inserted into. Node styles
 * live on the nodes and travel with them.
 */
function savedPatternDocument(
  document: BlockDocument,
  selected: readonly BlockNode[]
): SavedPattern | PlanRefusal {
  const stored: BlockDocument = {
    formatVersion: document.formatVersion,
    kind: "pattern",
    nodes: withoutOrigin(reidForestWithMap([...selected], "keep").nodes),
  };
  // Asked of what is STORED, not of the page it came from. Only some of the
  // source envelope travels: `formatVersion` is carried, and a page holding one
  // the apply does not accept would produce a pattern refused as
  // `unusable-document` by every insert — while `kind` is written here, so a
  // source whose own kind is unreadable still yields a perfectly good pattern.
  // Judging the source would refuse that second case for nothing, which is the
  // difference between asking about the thing and asking about its origin.
  return documentRefusal(stored) === undefined
    ? { document: stored }
    : { problem: "unusable-document" };
}

/**
 * Save a contiguous run over an EXISTING pattern.
 *
 * The pattern's tree becomes this selection; the library row keeps its own
 * metadata. It exists because the alternative is what every pattern library
 * without it turns into — `hero`, `hero-v2`, `hero-v2-final` — which the design
 * cites as Elementor's eight-year-old request. Only the tree is replaced: the
 * row's name and description belong to the library entry, not to the run, so
 * {@link PlannedUpdate} carries no fields for a caller to overwrite them with.
 *
 * **The document it stores is byte-for-byte what `planSaveAsPattern` would
 * store** from the same selection — one builder, for the reason
 * {@link savedPatternDocument} gives.
 *
 * ## Why this one touches the page, where saving a NEW pattern does not
 *
 * The commonest path here is insert, tweak, save back. Those roots carry an
 * `origin` naming this pattern and the digest they were copied at, and this
 * write moves the digest — so a run that is now byte-identical to the pattern
 * would report itself out of date against content it just defined. A staleness
 * signal that fires without cause is worse than none, because it teaches
 * authors to dismiss the one that means something.
 *
 * So the plan REPAIRS the record its own write would otherwise falsify, and
 * mints none:
 *
 * - a selected root already naming THIS pattern is re-stamped with the new
 *   digest, and ends in sync. Figma's `push changes to main component` leaves
 *   the pushing instance with nothing to reset for the same reason;
 * - a root naming a DIFFERENT pattern keeps naming it. It did come from there,
 *   and overwriting the record would attribute the copy to a pattern it has
 *   nothing to do with — see {@link withOrigin};
 * - a root with no record does not gain one. Nothing copied it from anywhere,
 *   and a record invented here would be a claim about history that is false.
 *   What that gives up is real: an author who draws a run from scratch and
 *   saves it over a pattern gets no in-sync record for it. That is the
 *   conservative direction, and the alternative writes something untrue.
 *
 * Only ROOTS, matching where {@link withOrigin} puts the record. A descendant
 * carrying one was a separate copy nested inside this content, and re-stamping
 * it would claim the pattern's whole tree is what that child came from.
 *
 * ## What it refuses
 *
 * The plan IS the dry run, so every refusal the ops it emits would meet is
 * made here: an envelope `applyOp` will not edit at all, and an addressed id
 * the document holds twice, which `update` refuses because it could not say
 * which node it meant.
 *
 * Everything it refuses about the SELECTION is what {@link planSaveAsPattern}
 * refuses, through the same call — listed there rather than repeated here,
 * because a second enumeration is a second thing to keep true and this one had
 * already fallen two behind before anyone read it.
 */
export function planUpdatePatternFromSelection(
  document: BlockDocument,
  selectedIds: readonly string[],
  target: PatternUpdateTarget,
  nesting: NestingSource
): PlanResult<never> {
  // The identity BEFORE anything is built on it, at runtime as well as in the
  // type: this is a published entry point and the value reaching it comes from
  // a JavaScript caller or a stored row as often as from a typed one. An id
  // that is not a non-empty string is one `isBlockOrigin` refuses, so the plan
  // would succeed and the update it emits would throw.
  if (typeof target.id !== "string" || target.id === "") {
    return { problem: "invalid-source" };
  }

  // Asked because this planner EMITS ops, where saving a new pattern emits
  // none. Everything `applyOp` checks before it looks at an op — the
  // envelope's keys, its values, its format and its kind — is a way a plan can
  // be built against a document that cannot be edited at all.
  if (
    documentRefusal(document) !== undefined ||
    // And the forest, not only the envelope: `applyOp` walks every node before
    // it applies anything, so a malformed sibling the author did not select
    // refuses the update this plan promises — after the library row has been
    // written, which is the order that cannot be taken back.
    forestRefusal(document.nodes) !== undefined
  ) {
    return { problem: "unusable-document" };
  }

  const saved = plannedSave(document, selectedIds, nesting);
  if (saved.problem !== undefined) return saved;

  // Over what is STORED, not over the selection as it sits on the page. The
  // digest excludes a ROOT's origin but keeps one deeper down, and the stored
  // copy has every origin stripped — so hashing the selection would produce a
  // number no later insert of this pattern could reproduce.
  const digest = patternDigest(saved.stored.nodes);

  const pageOps = restampOps(document, saved.selected, target.id, digest);
  if (pageOps.problem !== undefined) return pageOps;

  return {
    update: {
      collection: target.collection,
      id: target.id,
      document: saved.stored,
    },
    pageOps: pageOps.ops,
  };
}

/** The updates that bring the saved-over run back in sync, or why they cannot. */
interface RestampOps {
  readonly ops: readonly BuilderOp[];
  readonly problem?: undefined;
}

/**
 * One `update` per selected root whose provenance record this write falsifies.
 *
 * A root already at the new digest gets nothing. The op would be a literal
 * no-op, and emitting it would still cost an entry in the author's history —
 * an undo step that visibly does nothing is a worse answer than no step.
 */
function restampOps(
  document: BlockDocument,
  selected: readonly BlockNode[],
  patternId: string,
  digest: string
): RestampOps | PlanRefusal {
  const ops: BuilderOp[] = [];
  for (const root of selected) {
    const origin = root.origin;
    if (origin === undefined || origin.from !== "pattern") continue;
    if (origin.id !== patternId || origin.digest === digest) continue;
    // `update` addresses a node by id and refuses one the document holds
    // twice, because it could not say which node the patch was meant for.
    // Asked only of the roots actually addressed: a duplicate elsewhere in the
    // page is not something these ops would meet, and refusing on it would
    // block a save the apply would have accepted.
    if (countById(document.nodes, root.id) > 1) {
      return { problem: "duplicate-destination" };
    }
    ops.push({
      kind: "update",
      id: root.id,
      patch: { origin: { from: "pattern", id: patternId, digest } },
    });
  }
  return { ops };
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
 * A pattern as it is STORED: the document, and the identity the store gave it.
 *
 * Both, because inserting one records where the copy came from and a document
 * cannot say what row it is. Passed together rather than as two arguments so
 * they cannot be supplied out of step — an id belonging to a different pattern
 * than the nodes would write provenance that is worse than none, since it reads
 * as authoritative.
 */
export interface StoredPattern {
  /** The pattern entry's id. */
  readonly id: string;
  /** Its stored document. */
  readonly document: BlockDocument;
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
 * **Each inserted root records where it came from.** A pattern is still
 * copy-on-insert and keeps no link back — nothing re-reads the pattern to
 * update the copy — but the roots carry an inert `origin` naming the pattern
 * and the digest it was copied at, so a surface can later ask whether the
 * source has moved on. Only the roots: the run is what was inserted, and
 * marking every node would make detaching one child read as a second
 * insertion.
 */
export function planInsertPattern(
  document: BlockDocument,
  pattern: StoredPattern,
  target: InsertTarget,
  nesting: NestingSource
): PlanResult<never> {
  // The identity BEFORE anything is built on it. A record whose id is not a
  // non-empty string is one `isBlockOrigin` refuses, so the plan would succeed
  // and the insert throw. Checked at RUNTIME as well as in the type: this is a
  // published entry point, and the value reaching it comes from a JavaScript
  // caller or a stored row as often as from a typed one.
  if (typeof pattern.id !== "string" || pattern.id === "") {
    return { problem: "invalid-source" };
  }

  const stored = storedRefusal(document, pattern.document);
  if (stored !== undefined) return stored;

  const destination = destinationOf(document, target);
  if (destination.problem !== undefined) return destination;

  const copy = freshCopy(pattern.document.nodes, takenDomIds(document, target));
  if (copy.problem !== undefined) return copy;

  // Recorded on the way in, and OVERWRITTEN rather than filled in where absent:
  // a root can arrive carrying a record from an earlier copy. The digest is
  // taken from the pattern as it stands now, so a later reader can tell whether
  // the source has moved on since this copy was made.
  const marked = withOrigin(copy.nodes, {
    from: "pattern",
    id: pattern.id,
    digest: patternDigest(pattern.document.nodes),
  });

  const refusal =
    placementRefusal(marked, destination.place.where, nesting) ??
    internalNestingRefusal(marked, nesting) ??
    // The `"document"` target REMOVES what is there, and a remove refuses both
    // a locked subtree and a malformed node for the same reasons an insert
    // does. Only that target deletes anything; a positional insert adds.
    (target === "document"
      ? (lockRefusal(document.nodes) ?? shapeRefusal(document.nodes))
      : undefined);
  if (refusal !== undefined) return refusal;

  return {
    pageOps: insertOps(marked, destination.place, document, target),
  };
}

/**
 * What must be true of the two STORED documents, asked before anything is
 * copied out of either.
 *
 * Before, and not after, because copying is itself a step that can fail on a
 * stored document: `structuredClone` throws on a value JSON cannot carry — a
 * function reaching `props` from an in-process caller — and it throws a native
 * `DOMException` rather than the refusal this module promises. The shape rule
 * catches that same node, so asking it first turns a crash into a cause.
 */
function storedRefusal(
  document: BlockDocument,
  pattern: BlockDocument
): PlanRefusal | undefined {
  if (pattern.kind !== "pattern") return { problem: "not-a-pattern" };
  if (pattern.nodes.length === 0) return { problem: "empty" };
  // BOTH envelopes, judged by the apply's own document rule rather than by a
  // field of it. The ops are built from one document and applied to the other,
  // and everything `applyOp` asks before it looks at an op — the envelope's
  // keys, its values, its format and its kind — is a way a plan can be built
  // against a destination that cannot be edited at all.
  if (
    documentRefusal(document) !== undefined ||
    documentRefusal(pattern) !== undefined ||
    // The DESTINATION's whole forest, because `applyOp` walks it before it
    // applies anything — so a malformed entry nowhere near the insertion point
    // still refuses the op this plan promises.
    forestRefusal(document.nodes) !== undefined
  ) {
    return { problem: "unusable-document" };
  }
  return shapeRefusal(pattern.nodes) ?? duplicateDomIdRefusal(pattern.nodes);
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
function internalNestingRefusal(
  roots: readonly BlockNode[],
  nesting: NestingSource
): PlanRefusal | undefined {
  let refusal: PlanRefusal | undefined;
  walkNodes([...roots], node => {
    if (refusal !== undefined) return;
    for (const [slot, children] of Object.entries(node.slots ?? {})) {
      if (!Array.isArray(children)) continue;
      refusal ??= placementRefusal(
        children,
        { kind: "slot", parentType: node.type, slot },
        nesting
      );
    }
  });
  return refusal;
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
    // ONE id per node, through the shared rule. Reading `cssId` and the
    // attribute bag as two ids made a node spelling one id through both look
    // like it collided with itself — which `validateDomIds` explicitly does not
    // report, and rightly: the renderer emits a single id for it.
    const id = renderedDomId(node);
    if (id === undefined) return;
    if (seen.has(id)) {
      repeated = true;
      return;
    }
    seen.add(id);
  });
  return repeated ? { problem: "duplicate-dom-id" } : undefined;
}

/**
 * A locked node the replacing target would DELETE, phrased as a refusal.
 *
 * Only the destination side asks this now. A lock on the incoming pattern is
 * carried across the insert as an update rather than refused — see
 * {@link insertOps} — but a lock on the page is content an author protected,
 * and a remove refuses it for a reason no re-ordering of the group can satisfy.
 */
function lockRefusal(roots: readonly BlockNode[]): PlanRefusal | undefined {
  for (const root of roots) {
    if (lockedWithin(root) !== undefined) {
      return { problem: "destination-locked" };
    }
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
 * The copier is TOLD what the destination holds — that is what
 * {@link DomIdPolicy}'s `avoid` set is — and it mints only against that set, so
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
 * The property that IS covered, deterministically, is the one that matters in
 * practice: inserting one pattern twice into one page and finding no repeated
 * DOM id anywhere in the result.
 */
const MAX_ID_MINTING_ATTEMPTS = 3;

function freshCopy(
  roots: BlockNode[],
  taken: ReadonlySet<string>
): FreshCopy | PlanRefusal {
  for (let attempt = 0; attempt < MAX_ID_MINTING_ATTEMPTS; attempt += 1) {
    const minted = reidForestWithMap(roots, { avoid: taken });
    const clash = [...minted.domIds.values()].some(id => taken.has(id));
    if (!clash) return { nodes: minted.nodes };
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
function takenDomIds(
  document: BlockDocument,
  target: InsertTarget
): ReadonlySet<string> {
  return target === "document" ? new Set<string>() : domIdsIn(document.nodes);
}

/**
 * Every DOM id the destination actually RENDERS.
 *
 * Not every id it stores. A node carrying `cssId: "actual"` beside
 * `attributes.id: "hero"` emits only `actual`, so treating `hero` as taken made
 * an inserted pattern rename itself away from a string the page never puts on
 * screen — renaming authored content to avoid a collision that cannot happen.
 * {@link renderedDomId} is the one rule for which of the two a node emits, and
 * it folds attribute names because HTML does.
 *
 * A later edit CAN un-shadow the bag — clearing that `cssId` makes `hero`
 * render — and this cannot prevent that, any more than it can prevent an author
 * typing a duplicate afterwards. Validation reports it when it happens.
 */
function domIdsIn(nodes: BlockNode[]): Set<string> {
  const taken = new Set<string>();
  walkNodes(nodes, node => {
    const id = renderedDomId(node);
    if (id !== undefined) taken.add(id);
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
 *
 * ## A locked block arrives unlocked and is locked once it has landed
 *
 * `applyOp` refuses an insert whose subtree arrives locked, because the inverse
 * of an insert is a remove and a remove refuses a locked subtree — so such an
 * insert could never be undone. That rule is right, and taken literally it made
 * a whole supported flow impossible: saving a selection containing a locked
 * block succeeds, the stored pattern keeps the lock, and the pattern was then
 * insertable nowhere. A library row nothing can place is worse than either
 * refusing the save or dropping the lock without saying so.
 *
 * So the lock is neither carried on the insert nor discarded: the nodes arrive
 * unlocked and an update locks them where they landed. The group ends in the
 * state the pattern described, and it stays undoable because inverses are
 * recorded in undo order — the unlock runs before the remove, so the remove
 * never meets a locked node.
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
  const { nodes, lockedIds } = withoutLocks(roots);
  const start = place.at === null ? 0 : place.at.index;
  nodes.forEach((node, offset) => {
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
  for (const id of lockedIds) {
    ops.push({ kind: "update", id, patch: { locked: true } });
  }
  return ops;
}

/** A forest with every lock removed, and the ids that carried one. */
interface UnlockedForest {
  readonly nodes: BlockNode[];
  readonly lockedIds: readonly string[];
}

/**
 * Take the locks off, remembering where they were.
 *
 * Through the shared forest rewrite rather than a walk of its own: a
 * hand-rolled traversal has to re-learn what that one already knows about a
 * cycle entry, a malformed entry and a malformed slot value, and a planner
 * editing one field has no business deciding any of them.
 *
 * Only `locked` moves; every other field is carried across untouched.
 */
function withoutLocks(roots: readonly BlockNode[]): UnlockedForest {
  const lockedIds: string[] = [];
  const nodes = mapForest([...roots], node => {
    if (node.locked !== true) return node;
    lockedIds.push(node.id);
    const { locked: _locked, ...rest } = node;
    return rest;
  });
  return { nodes, lockedIds };
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
function withoutOrigin(roots: readonly BlockNode[]): BlockNode[] {
  return mapForest([...roots], node => {
    if (node.origin === undefined) return node;
    const { origin: _origin, ...rest } = node;
    return rest;
  });
}

/**
 * The inserted roots, each recording the pattern it came from.
 *
 * OVERWRITTEN, never filled in only where absent: a root can arrive carrying a
 * record from an earlier copy, and leaving that in place would attribute this
 * insertion to a pattern it has nothing to do with. Only the ROOTS are marked,
 * because the run is what was inserted — a descendant did not come from the
 * pattern separately, and marking every node would make an author detaching one
 * child look like a second insertion.
 */
function withOrigin(
  roots: readonly BlockNode[],
  origin: BlockOrigin
): BlockNode[] {
  return roots.map(root => ({ ...root, origin }));
}
