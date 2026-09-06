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
import {
  COMPONENT_INSTANCE_TYPE,
  isComponentDocument,
  renderedDomId,
} from "./document";
import type {
  BlockDocument,
  BlockNode,
  BlockOrigin,
  ComponentDocument,
  ExposedProperty,
  ExposedPropertyType,
  ExposedSlot,
} from "./document";
import { DEFAULT_LIMITS, MAX_ENVELOPE_ENTRIES } from "./limits";
import type { DocumentLimits } from "./limits";
import { surveyDocument } from "./measure-bytes";
import {
  canBeRoot,
  canNest,
  canNestInSlot,
  type NestingRefusal,
  type NestingSource,
  type NestingVerdict,
} from "./nesting";
import {
  applyOps,
  documentRefusal,
  listRefusal,
  forestRefusal,
  lockedWithin,
  nodeShapeRefusal,
  positionRefusal,
  subtreeRemovalRefusal,
  type BuilderOp,
  type OpPosition,
} from "./ops";
import { patternDigest } from "./pattern-digest";
import { isPlainRecord } from "./plain-record";
import { componentIdsIn } from "./resolve-instances";
import { boundedOwnKeys, defineEntry } from "./safe-record";
import { contiguousRun, type RunProblem } from "./sibling-run";
import {
  findNode,
  hiddenSubtreeNodes,
  mapForest,
  newId,
  reidForestWithMap,
  walkNodes,
} from "./tree";
import { componentEnvelopeIssues } from "./validation";
import type { ValidationIssue } from "./validation";

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
  /**
   * The id to create it under, when the page ops already name it.
   *
   * Absent for a save that only fills the library: nothing points at the row,
   * so whichever id the collection assigns is the right one. Present for a
   * CONVERT, where the instance left on the page carries the definition's id
   * in its props — the ops and the row have to agree, and the only moment they
   * can be made to is before either is written. So the caller decides the id
   * and the plan echoes it back, rather than the plan minting one in a format
   * it cannot know the collection accepts.
   *
   * Not a nullable id standing in for the create/overwrite distinction, which
   * {@link CompositionPlan.update} exists to keep separate: this says WHERE,
   * never WHETHER.
   */
  readonly id?: string;
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
  readonly issues?: undefined;
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
  | "invalid-source"
  /**
   * The exposure nominated would not survive the definition's publish gate.
   *
   * Its own cause rather than folded into `"unusable-document"`, because the
   * two have opposite remedies: an unusable document is refused whatever the
   * author does next, where this names a property they nominated and can
   * withdraw. {@link PlanRefusal.issues} carries which one.
   */
  | "invalid-exposure"
  /**
   * A nomination names a node id the selection holds more than once.
   *
   * Told apart from `"invalid-exposure"` because nothing about the envelope is
   * malformed — the pointer resolves, to one of two nodes that answered to the
   * name — so the author's remedy is to pick a node rather than to fix a field.
   */
  | "ambiguous-exposure"
  /**
   * Applying the plan would put the page past a limit the caller set.
   *
   * Its own cause because the remedy is neither the author's selection nor
   * their exposure: the page is at its ceiling, and what has to change is the
   * page or the ceiling.
   */
  | "exceeds-limits"
  /**
   * The definition would contain an instance of itself.
   *
   * Its own cause because nothing about the selection or the exposure is
   * malformed: the run being converted already referenced the component about
   * to be created, and the author has to remove that instance or create the
   * component under a different id.
   */
  | "self-reference"
  /** The document handed over is not a component definition. */
  | "not-a-component";

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
  /**
   * For `"invalid-exposure"`: what the envelope check said, unabridged.
   *
   * The issues rather than a count or a first cause, because the surface that
   * asked for this plan is the one holding the list of properties the author
   * nominated, and each issue carries the `/exposed/<i>` path that names which.
   * Reporting "the exposure is invalid" would send them back to re-check every
   * one of them.
   */
  readonly issues?: readonly ValidationIssue[];
  readonly create?: undefined;
  readonly update?: undefined;
  readonly pageOps?: undefined;
}

export type PlanResult<TFields> = CompositionPlan<TFields> | PlanRefusal;

/**
 * Where a saved selection is stored, in the caller's vocabulary.
 *
 * One type for all three library kinds rather than one per planner. A pattern,
 * a component and a layout are stored the same way — a collection slug and
 * whatever metadata that collection declares — so three identical interfaces
 * would be three things to keep in step for a distinction none of them draws.
 */
export interface LibraryTarget<TFields> {
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
  target: LibraryTarget<TFields>,
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
  /** Page node id to stored node id — see {@link SavedPattern.nodeIds}. */
  readonly nodeIds: ReadonlyMap<string, string>;
  /** Where the run sat, for a planner that must put something back there. */
  readonly at: RunPlacement;
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

  return {
    selected: run.selected,
    stored: stored.document,
    nodeIds: stored.nodeIds,
    at: run.at,
  };
}

/** The pattern document a save would store, or why it could not. */
interface SavedPattern {
  readonly document: BlockDocument;
  /**
   * Each selected node's id ON THE PAGE, mapped to the id it was stored under.
   *
   * Carried rather than discarded because a caller that points INTO the
   * selection — a component definition exposing one of its nodes' props — names
   * those nodes in the page's vocabulary, and the save re-mints every one of
   * them. Without the map a pointer that was correct when it was nominated
   * names a pre-copy id the stored document does not contain: a definition that
   * loads, renders, offers the property in the inspector, and writes overrides
   * that resolve to nothing.
   *
   * Empty of DOM ids on purpose. Those are KEPT by this save, so there is no
   * remapping to publish — see {@link savedPatternDocument}.
   */
  readonly nodeIds: ReadonlyMap<string, string>;
  readonly problem?: undefined;
  readonly permitted?: undefined;
}

/** A selection that may be lifted into a document of its own. */
interface SavableRun {
  readonly selected: readonly BlockNode[];
  readonly at: RunPlacement;
  readonly problem?: undefined;
  readonly permitted?: undefined;
}

/**
 * Where a run sat in the document it was selected from.
 *
 * Reported as the run gave it — the two container fields independently
 * optional — rather than as an {@link OpPosition}, which ties them together.
 * Narrowing here would mean deciding what a half-set container MEANS at the
 * point that has the least to go on, and the honest answer is that it is not a
 * position at all. {@link replaceOps} refuses it as one.
 */
interface RunPlacement {
  /** The node whose slot held the run, absent at the top level. */
  readonly parentId?: string;
  /** The slot within that parent, absent at the top level. */
  readonly slot?: string;
  /** The index of the run's FIRST node in that sibling list. */
  readonly index: number;
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
 * The duplicate-DOM-id question is NOT asked here. It belongs to the document
 * this becomes rather than to the selection it came from — see
 * {@link savedPatternDocument}. Asking in both places would be one question
 * with two answers.
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
    placementRefusal(selected, { kind: "root" }, nesting) ??
    internalNestingRefusal(selected, nesting);
  if (refusal !== undefined) return refusal;

  // Read off the run rather than searched for again. A second lookup of one id
  // can answer differently from the first, which is the mistake this module has
  // already made once — and `places` is sorted, so the first entry is the one
  // an insert has to land on.
  const { parentId, slot } = result.run;
  return {
    selected,
    at: {
      ...(parentId === undefined ? {} : { parentId }),
      ...(slot === undefined ? {} : { slot }),
      index: result.run.places[0].index,
    },
  };
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
 * insert renames only what its own destination already holds.
 *
 * A copy an insert DID rename comes back carrying the renamed value, so saving
 * it over its own pattern moves that pattern's fingerprint and reports every
 * other copy stale for an edit nobody made. Undoing it needs to know what was
 * renamed. That cannot be inferred from the value: a minted id is the authored
 * one plus a suffix drawn from the node's own id, and content generated by a
 * script or an import may name its anchors that way deliberately — so a rule
 * reading the shape alone silently rewrites authored ids and the references to
 * them. Restoring it properly needs the insert to record what it changed, which
 * is a change to the stored provenance record rather than a rule this can
 * apply on its own. Minting here
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
  // KEEP every id, except the ones an insert renamed to fit this page: those
  // go back to what the source calls them. The two are one policy rather than a
  // second pass, so node ids are minted once and the map this returns still
  // describes the document it comes with.
  const restore = restoredDomIds(selected);
  const copied = reidForestWithMap(
    [...selected],
    restore.size === 0 ? "keep" : { restore }
  );
  const stored: BlockDocument = {
    formatVersion: document.formatVersion,
    kind: "pattern",
    // Through the shared forest rewrite, which preserves every id it was given
    // — so the map `reidForestWithMap` returned still describes these nodes.
    nodes: withoutOrigin(copied.nodes),
  };
  // Asked of what is STORED rather than of the selection, for the reason the
  // envelope question below is: the stored document is what an insert will
  // meet, and only some of what the page holds travels into it.
  const duplicate = duplicateDomIdRefusal(stored.nodes);
  if (duplicate !== undefined) return duplicate;

  // Asked of what is STORED, not of the page it came from. Only some of the
  // source envelope travels: `formatVersion` is carried, and a page holding one
  // the apply does not accept would produce a pattern refused as
  // `unusable-document` by every insert — while `kind` is written here, so a
  // source whose own kind is unreadable still yields a perfectly good pattern.
  // Judging the source would refuse that second case for nothing, which is the
  // difference between asking about the thing and asking about its origin.
  return documentRefusal(stored) === undefined
    ? { document: stored, nodeIds: copied.nodeIds }
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
  // Decided WITHOUT reading the document, so a plan that turns out to edit
  // nothing never has to be right about a page it will not touch.
  const stale = selected.filter(root => {
    const origin = root.origin;
    if (origin === undefined || origin.from !== "pattern") return false;
    return origin.id === patternId && origin.digest !== digest;
  });
  // A group with NO ops is not applied: `applyOps` runs no preflight for it,
  // neither the envelope nor the forest. So the destination has to be editable
  // only when something is going to be applied to it — and a save-over of a
  // clean selection still writes its library row on a page holding a malformed
  // sibling somewhere, which is a save the apply would never have refused.
  if (stale.length === 0) return { ops: [] };

  // Everything `applyOp` asks before it looks at an op. The envelope, and then
  // the whole forest, because it walks every node before applying anything —
  // so a malformed sibling the author never selected refuses the update this
  // plan promises, after the library row has been written.
  if (
    documentRefusal(document) !== undefined ||
    forestRefusal(document.nodes) !== undefined
  ) {
    return { problem: "unusable-document" };
  }

  // Of the roots actually addressed, which for this planner is the stale ones:
  // a duplicate elsewhere in the page is not something these ops would meet.
  const ambiguous = ambiguousRootRefusal(document, stale);
  if (ambiguous !== undefined) return ambiguous;

  return {
    ops: stale.map(root => ({
      kind: "update",
      id: root.id,
      patch: { origin: { from: "pattern", id: patternId, digest } },
    })),
  };
}

// ---------------------------------------------------------------------------
// Components — a selection saved as a LINKED definition
// ---------------------------------------------------------------------------

/**
 * One property of the saved definition an instance will be allowed to override.
 *
 * Named in the PAGE's vocabulary: `nodeId` is a node id as it stands in the
 * document being saved from, because that is the only id the surface that
 * nominated it has ever seen. The save re-mints every one of them, and the
 * planner re-aims the pointer — see {@link SavedPattern.nodeIds}.
 *
 * ## Why the caller nominates these and the planner does not derive them
 *
 * Which of a block's props is a headline and which is a spacing knob is a
 * property of that block's DEFINITION, and the engine cannot read one: a
 * planner is pure and holds no registry, by ruling, so the vocabulary it would
 * have to classify by is not reachable from here. The same boundary already
 * stops this module synthesising an `assets` index and stops the envelope
 * validator resolving a `propPath` against a schema.
 *
 * That is a division of labour rather than a limitation. The surface doing the
 * nominating has the registry, and it also has the author — and every
 * comparable tool measured (Webflow, Figma, Framer, Builder.io, WordPress
 * synced patterns) makes the author confirm each editable field rather than
 * committing silently. A pre-selection is a suggestion to review; the planner's
 * job is to say whether the reviewed answer will survive being stored.
 */
export interface RequestedProperty {
  /** The stable slug instances will key their overrides by. */
  readonly id: string;
  /** What the inspector will call it. */
  readonly label: string;
  /** A node id in the SOURCE document, inside the selection. */
  readonly nodeId: string;
  /** Dot path into that node's props, in the binding-path grammar. */
  readonly propPath: string;
  readonly type: ExposedPropertyType;
  /** The choices, for `select` only. */
  readonly options?: readonly { value: string; label: string }[];
}

/**
 * A region of the saved definition an instance will be allowed to fill.
 *
 * `nodeId` is a SOURCE document id, on the same terms as
 * {@link RequestedProperty.nodeId}. No `id` field: the key of
 * {@link ComponentExposure.slots} is the id, for the reason {@link ExposedSlot}
 * gives — one spelling makes a disagreement between key and field
 * unrepresentable rather than merely detectable.
 */
export interface RequestedSlot {
  readonly label: string;
  readonly nodeId: string;
  /** Which of that node's slots. */
  readonly slot: string;
  /** Block types the slot accepts; unset accepts whatever the container does. */
  readonly allow?: readonly string[];
}

/** What the author chose to leave editable on the component being saved. */
export interface ComponentExposure {
  readonly properties?: readonly RequestedProperty[];
  readonly slots?: Readonly<Record<string, RequestedSlot>>;
}

/**
 * Save a contiguous run of blocks as a component DEFINITION.
 *
 * **The page is not touched**, exactly as {@link planSaveAsPattern} does not
 * touch it: this fills the library and leaves the original blocks where they
 * are. Replacing them with an instance is {@link planConvertToComponent}, and
 * the difference between the two is that one line of ops and nothing else.
 *
 * **The tree it stores is byte-for-byte the tree a pattern save would store**
 * from the same selection — one builder, {@link savedPatternDocument}, for the
 * reason given there. A component is that document plus an envelope and a
 * `kind`, not a second way of copying a selection.
 *
 * ## The envelope is where the ids stop matching
 *
 * `exposed` and `slots` are POINTERS into the tree, and the save re-mints every
 * node id in it. A pointer copied across unchanged names a pre-copy id the
 * stored document does not contain — and that definition loads, renders, and
 * offers the property in the inspector, where editing it writes an override
 * that resolves to nothing. The failure surfaces on every instance in the site
 * as "my change did nothing", far from the save that caused it.
 *
 * So each pointer is re-aimed through the map the copy returned. A nomination
 * naming a node OUTSIDE the selection has no entry in that map and is carried
 * across untouched, which the envelope check then reports for exactly what it
 * is. That is deliberate: minting a fresh id makes the collision impossible, so
 * a surviving page id cannot be mistaken for a stored one, and the rule that
 * says whether a pointer resolves stays in one place instead of two.
 *
 * ## What it refuses
 *
 * Everything {@link planSaveAsPattern} refuses about the selection, through the
 * same call — plus everything the definition's own publish gate would refuse
 * about the envelope, asked as {@link componentEnvelopeIssues} rather than
 * re-implemented: a pointer at a node that is not there, two exposures sharing
 * an id, a prop path that is not a path, options on something that is not a
 * `select` and a `select` without them, a slot the node does not declare, and a
 * type outside the vocabulary. Strict validation is the publish gate for this
 * collection, so a definition that fails it is one an author could save and
 * never publish; refusing here happens while they still have the selection in
 * front of them.
 */
export function planSaveAsComponent<TFields>(
  document: BlockDocument,
  selectedIds: readonly string[],
  target: LibraryTarget<TFields>,
  exposure: ComponentExposure,
  nesting: NestingSource,
  limits: DocumentLimits = DEFAULT_LIMITS
): PlanResult<TFields> {
  const saved = plannedSave(document, selectedIds, nesting);
  if (saved.problem !== undefined) return saved;

  const definition = componentDocument(saved, exposure, limits);
  if (definition.problem !== undefined) return definition;

  return {
    create: {
      collection: target.collection,
      document: definition.document,
      fields: target.fields,
    },
    pageOps: [],
  };
}

/**
 * Save a run as a component AND replace it on the page with one instance.
 *
 * {@link planSaveAsComponent} plus the ops that take the run out and put a
 * linked instance where it stood. Built here beside it rather than in a second
 * module, because the two have to agree about what was stored and where it came
 * from, and a save whose replacement is written somewhere else is a round trip
 * nothing tests end to end.
 *
 * ## The definition's id comes from the caller
 *
 * The instance carries the definition's id in its props, so the ops and the row
 * they point at have to agree — and the only moment they can be made to is
 * before either is written. A planner cannot mint one: the id format belongs to
 * the collection the row lands in, which the engine cannot see. So the caller
 * decides it, the ops name it, and {@link PlannedCreate.id} echoes it back so
 * the plan is executable without its caller having to remember what it passed.
 *
 * A caller that creates the row under a DIFFERENT id has built an instance
 * pointing at nothing. That is the one failure this shape cannot refuse, and it
 * is refusable by construction on the other side: the create and the ops are
 * one unit of work, and the id is an input to both.
 *
 * ## Ops, in this order
 *
 * Every selected root is removed, then one instance is inserted at the index
 * the first of them held. The run is contiguous and sorted, so after the
 * removes that index is where the run began — including when the run ended the
 * list, where it is an append.
 *
 * ## What it refuses that the save alone does not
 *
 * The plan IS the dry run, so every refusal these ops would meet is made here:
 * a locked block on the page, which `remove` refuses for a reason no re-ordering
 * of the group can satisfy; a selected root the document holds twice, which
 * `remove` refuses because it could not say which it meant; a container that is
 * gone or duplicated; and a slot whose own rules will not take a component
 * instance. The nesting question is asked of the INSTANCE rather than of the
 * blocks it replaces — they are not the node going in, and a slot that accepted
 * a heading need not accept a component.
 */
export function planConvertToComponent<TFields>(
  document: BlockDocument,
  selectedIds: readonly string[],
  target: LibraryTarget<TFields>,
  componentId: string,
  exposure: ComponentExposure,
  nesting: NestingSource,
  limits: DocumentLimits = DEFAULT_LIMITS
): PlanResult<TFields> {
  // Before anything is built on it, at runtime as well as in the type, for the
  // reason the save-over checks its target id: this is a published entry point
  // and the value reaching it comes from a JavaScript caller as often as from a
  // typed one. An empty id yields an instance that references nothing, and no
  // later stage looks at it again.
  if (typeof componentId !== "string" || componentId === "") {
    return { problem: "invalid-source" };
  }

  const saved = plannedSave(document, selectedIds, nesting);
  if (saved.problem !== undefined) return saved;

  const definition = componentDocument(saved, exposure, limits);
  if (definition.problem !== undefined) return definition;

  // A definition holding an instance of ITSELF. The selection can already
  // contain one — a dangling `def-1` on the page, converted while creating
  // `def-1` — and the resolver classifies that as a cycle and leaves it
  // unresolved, so a conversion whose dry run succeeded replaces visible
  // content with a broken placeholder. Asked through the resolver's own
  // published index, not a walk of this module's own.
  if (componentIdsIn(definition.document.nodes).includes(componentId)) {
    return { problem: "self-reference" };
  }

  const replaced = replaceOps(document, saved, componentId, nesting, limits);
  if (replaced.problem !== undefined) return replaced;

  return {
    create: {
      collection: target.collection,
      id: componentId,
      document: definition.document,
      fields: target.fields,
    },
    pageOps: replaced.ops,
  };
}

/**
 * Duplicate a component definition into a library row of its own.
 *
 * **The envelope is re-aimed, not merely carried.** A definition is not only a
 * tree: `exposed` and `slots` are POINTERS into it, and a duplicate re-identifies
 * every node. Copying the pointers across unchanged produces a document that
 * loads, renders, shows its properties in the inspector — and fails its own
 * publish gate with one error per exposure, because strict validation refuses a
 * pointer at a node the document does not contain. The design's one line for
 * this planner does not reach that; `reidForestWithMap` returns `nodeIds` for
 * exactly this purpose.
 *
 * **Exposed ids are KEPT.** Variant presets are keyed by them, so re-minting
 * would demand a second rewrite of every variant's keys and buy nothing: a fresh
 * duplicate has no instances, and an exposed id is scoped to its own document,
 * so two definitions sharing one is not a collision.
 *
 * **DOM ids are KEPT**, for the reason a saved pattern keeps them: the duplicate
 * is a document of its OWN rather than a copy placed beside the original, so
 * there is nothing to collide with. Composition mints per-instance ids when it
 * inlines a definition, so two definitions carrying one `cssId` never put two of
 * them on a page.
 *
 * **The SOURCE is asked one question first.** `documentRefusal` refuses a
 * document JSON cannot write, and it reads the whole document — the envelope
 * included. That is what makes every field below safe to read once: a stored row
 * whose `exposed` is an accessor, or whose entries are computed, is refused
 * before anything walks it. A caller-supplied REQUEST has no such rule and has
 * to be read into data first; a stored document does, and asking it is cheaper
 * and more honest than restating it.
 */
export function planDuplicateComponent<TFields>(
  definition: BlockDocument,
  target: LibraryTarget<TFields>,
  limits: DocumentLimits = DEFAULT_LIMITS
): PlanResult<TFields> {
  // The CONTAINER, before its kind is read off it. This is a published entry
  // point handed a stored row, and a row can be `null` — where reading `.kind`
  // takes a native error out of a function that promises a refusal.
  if (!isPlainRecord(definition)) return { problem: "not-a-component" };
  // The KIND, before anything is read as an envelope. A pattern duplicated
  // through here would be stored as a component and refused by the collection
  // it landed in, having reported success.
  if (!isComponentDocument(definition)) return { problem: "not-a-component" };
  // The envelope AND the forest, paired as every other planner in this module
  // pairs them. `documentRefusal` reads the envelope and the `nodes` array —
  // not the entries inside it — so a `null` among the nodes, or nested in a
  // slot, is copied without complaint into a duplicate that plans successfully
  // and then cannot be published, since strict validation is the gate for this
  // collection and refuses the node it holds.
  if (
    documentRefusal(definition) !== undefined ||
    forestRefusal(definition.nodes) !== undefined
  ) {
    return { problem: "unusable-document" };
  }

  const source: ComponentDocument = definition;
  const copied = reidForestWithMap([...source.nodes], "keep");
  const duplicate = {
    ...source,
    kind: "component" as const,
    nodes: copied.nodes,
    ...aimedExposed(source.exposed, copied.nodeIds),
    ...aimedSlotMap(source.slots, copied.nodeIds),
  } satisfies ComponentDocument;

  const issues = componentEnvelopeIssues(duplicate, limits);
  if (issues.length > 0) return { problem: "invalid-exposure", issues };

  return (
    definitionRefusal(duplicate, limits) ?? {
      create: {
        collection: target.collection,
        document: duplicate,
        fields: target.fields,
      },
      pageOps: [],
    }
  );
}

/**
 * A definition's exposed list, re-aimed at the copy.
 *
 * Bounded and shape-guarded on the same terms a nomination is, because a stored
 * row is untrusted in the same ways — but read ONCE without a snapshot pass,
 * since `documentRefusal` has already refused a document whose fields compute
 * themselves. What is left is plain data that may still be the wrong shape, and
 * anything this cannot re-aim is carried for the envelope check to name.
 */
function aimedExposed(
  exposed: unknown,
  nodeIds: ReadonlyMap<string, string>
): { exposed?: ExposedProperty[] } {
  if (exposed === undefined) return {};
  if (!Array.isArray(exposed) || exposed.length > MAX_ENVELOPE_ENTRIES) {
    return { exposed: exposed as ExposedProperty[] };
  }
  const aimed: ExposedProperty[] = [];
  for (const one of exposed) aimed.push(aimedProperty(one, nodeIds));
  return { exposed: aimed };
}

/** A definition's slot map, re-aimed at the copy, on the same terms. */
function aimedSlotMap(
  slots: unknown,
  nodeIds: ReadonlyMap<string, string>
): { slots?: Record<string, ExposedSlot> } {
  if (slots === undefined) return {};
  if (!isPlainRecord(slots)) {
    return { slots: slots as Record<string, ExposedSlot> };
  }
  const names = boundedOwnKeys(slots, MAX_ENVELOPE_ENTRIES);
  if (names === null) return { slots: slots as Record<string, ExposedSlot> };
  const aimed: Record<string, ExposedSlot> = {};
  for (const id of names) defineEntry(aimed, id, aimedSlot(slots[id], nodeIds));
  return { slots: aimed };
}

/** The definition a component save would store, or why it could not. */
interface SavedComponent {
  readonly document: ComponentDocument;
  readonly problem?: undefined;
  readonly permitted?: undefined;
  readonly issues?: undefined;
}

/**
 * The saved tree, plus the envelope the author nominated, re-aimed and checked.
 *
 * ONE implementation, called by both component planners, for the reason
 * {@link savedPatternDocument} is: save and convert must produce the identical
 * definition from the identical selection, and two builders that agreed today
 * would diverge the day one of them moved.
 *
 * The envelope is checked on what is STORED rather than on what was nominated.
 * Only some of a nomination travels — the pointer is re-aimed and the rest is
 * carried verbatim — so judging the request would answer about a document
 * nobody stores. The same distinction {@link savedPatternDocument} draws, and
 * it has caught a defect on each side of it.
 */
function componentDocument(
  saved: PlannedSave,
  exposure: ComponentExposure,
  limits: DocumentLimits
): SavedComponent | PlanRefusal {
  // The CONTAINER, before either field is read off it. The guards below judge
  // the fields and their entries; none of them can be reached at all if the
  // request itself is not a record — `null` throws, and a string or an array
  // answers `undefined` to both reads and is silently taken for "expose
  // nothing", which reports success for a request nobody could honour.
  //
  // `undefined` is the exception and means exactly that: a caller with nothing
  // to expose. It is the one value that says so rather than failing to say
  // anything.
  if (exposure !== undefined && !isPlainRecord(exposure)) {
    return { problem: "invalid-exposure" };
  }
  const asked: ComponentExposure = exposure ?? {};

  // ONCE, before either pass. Both work from the result, so the id the guard
  // judges is the id the mapper stores.
  const read = readExposure(asked);

  // A collection nothing may read is refused HERE rather than handed on. The
  // envelope check is what names what is wrong with a value this cannot map —
  // but only for a value it can itself read, and an array with an accessor
  // index explodes wherever it is first touched.
  if (unreadable(read)) return { problem: "invalid-exposure" };

  const ambiguous = ambiguousNomination(saved.selected, read);
  if (ambiguous !== undefined) return ambiguous;

  const definition: ComponentDocument = {
    ...saved.stored,
    kind: "component",
    ...exposedProperties(read, saved.nodeIds),
    ...exposedSlots(read, saved.nodeIds),
  };

  // The HOST's limits, not this module's default. The envelope check indexes
  // the forest under whatever node cap it is given, and a host that raised
  // `maxNodes` can hold a definition larger than the default — whose later
  // nodes then fall outside a default-sized index, so its exposures are
  // reported as pointing at nothing. Strict validation, the gate this predicts,
  // is given the host's limits; a dry run using its own would refuse a
  // component the apply would publish, which is the direction nobody can debug.
  const issues = componentEnvelopeIssues(definition, limits);
  if (issues.length > 0) return { problem: "invalid-exposure", issues };

  // The stored-document rule, asked of the definition WITH its envelope on.
  // `savedPatternDocument` asks it of the tree, before there is an envelope —
  // and the envelope is caller-supplied, so a field this cannot judge can still
  // make the whole document unstorable: an option carrying a `BigInt` survives
  // the envelope check, which reads `value` and `label`, and JSON cannot write
  // it. The plan would report success and the create would fail on save.
  return definitionRefusal(definition, limits) ?? { document: definition };
}

/**
 * The exposure request, read ONCE into plain data.
 *
 * Every value this module will use is taken here and never asked for again.
 * That is the whole point: a request reaching a published entry point may hold
 * accessors, and until this pass runs nothing about it is data. Reading a field
 * where it is needed meant reading it several times — and a value that answers
 * differently on each read makes two passes disagree about the same nomination.
 *
 * Measured before this existed: `nodeId` was read three times, twice by the
 * ambiguity guard and once by the mapper. A getter answering `safe` twice and
 * then `dup` walked past the guard and stored the ambiguous pointer the guard
 * exists to refuse — the plan reporting success, the pointer resolving, and
 * every instance override editing a node the author never chose.
 *
 * It is also the one place a bound belongs. Each collection was bounded
 * wherever it happened to be traversed, which is three chances to add a fourth
 * traversal and forget.
 *
 * SHAPE-PRESERVING, not shape-correcting. A value this cannot read is carried
 * across exactly as given, because the envelope check is what says what is
 * wrong with it, in the vocabulary the publish gate already uses. Normalising
 * here would answer for a document nobody stores.
 */
interface ReadExposure {
  /** The nominated properties. */
  readonly properties: ReadCollection;
  /** The nominated slot regions. */
  readonly slots: ReadMap;
  /**
   * Every source node id the read entries name.
   *
   * Collected DURING the read rather than by a later pass over the result, and
   * that is what makes the bound hold: a collection carried verbatim because it
   * is over-cap or unreadable was never traversed, so it names nothing here and
   * a second pass cannot go looking. A separate walk would have to re-apply the
   * same bound, which is a second place to add a traversal and forget.
   */
  readonly named: readonly string[];
}

/**
 * A collection this module READ, one it is CARRYING, or one that is absent.
 *
 * Three states with three names rather than one value standing for all of them,
 * for the reason {@link PlacementTarget} gives about nullable parents: a
 * collection carried verbatim — past the cap, or the wrong shape — is still an
 * array as often as not, so anything reading it as "the entries" walks exactly
 * what the cap refused. Measured twice while writing this. Only `"read"` holds
 * entries, so only entries can be mapped, and the mistake stops being
 * representable rather than merely being fixed.
 */
type ReadCollection =
  | { readonly kind: "absent" }
  | { readonly kind: "read"; readonly entries: readonly unknown[] }
  | { readonly kind: "carried"; readonly value: unknown }
  /**
   * A collection nothing may read — not this module, and not the validator.
   *
   * Distinct from `"carried"`, which hands a value on for the envelope check to
   * refuse in its own words. That only works for a value the check can READ: an
   * array whose indices are accessors explodes wherever it is first touched, so
   * carrying it moves the explosion into validation instead of preventing it.
   * Measured exactly that way.
   */
  | { readonly kind: "unreadable" };

/**
 * The same three states for the slot MAP, whose keys are the exposure ids.
 *
 * Its own type rather than a list's, because the two are not interchangeable
 * and one type covering both is how the carried case came to be walked as
 * entries in the first place: a map read successfully is not a list of entries,
 * and a map carried verbatim must not be read at all.
 */
type ReadMap =
  | { readonly kind: "absent" }
  | { readonly kind: "read"; readonly slots: Record<string, unknown> }
  | { readonly kind: "carried"; readonly value: unknown }
  | { readonly kind: "unreadable" };

function readExposure(exposure: ComponentExposure): ReadExposure {
  const named: string[] = [];
  return {
    properties: readEntries(exposure.properties, one =>
      readProperty(one, named)
    ),
    slots: readSlotMap(exposure.slots, named),
    named,
  };
}

/**
 * A list of entries, bounded and read by index; anything else verbatim.
 *
 * By index because `map` and `Symbol.iterator` are inherited members a caller
 * may shadow, which throws where this module promises a refusal — on a list
 * whose entries are all well formed. Bounded because the envelope check refuses
 * an over-cap list in one step, so reading it first is precisely the work that
 * cap exists to refuse; the over-cap value is handed on for that refusal.
 */
function readEntries(
  value: unknown,
  read: (one: unknown) => unknown
): ReadCollection {
  if (value === undefined) return { kind: "absent" };
  if (!Array.isArray(value)) return { kind: "carried", value };
  // The list is DATA before a single index of it is read. An index can be an
  // accessor even on a genuine array whose entries are all well formed, so
  // neither the array check above nor the entry guards below see it — and
  // reading one runs the caller's code: a throwing getter escapes as a native
  // error, and one that appends extends `length` underneath the very bound that
  // is supposed to hold this loop. Carried for the validator to refuse, which
  // is what happens to every value this cannot read.
  if (listRefusal(value, "an exposure list") !== undefined) {
    return { kind: "unreadable" };
  }
  if (value.length > MAX_ENVELOPE_ENTRIES) return { kind: "carried", value };
  const entries: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    entries.push(read(value[index]));
  }
  return { kind: "read", entries };
}

/** A nested list as the envelope should hold it, read or carried. */
function nestedValue(collection: ReadCollection): unknown {
  if (collection.kind === "absent") return undefined;
  if (collection.kind === "read") return collection.entries;
  // An unreadable nested list becomes an empty one rather than travelling into
  // the envelope: it is a list nothing may touch, and the entry holding it is
  // refused by the caller of this read anyway.
  return collection.kind === "carried" ? collection.value : [];
}

/** The slot map, bounded to its own keys; anything else verbatim. */
function readSlotMap(value: unknown, named: string[]): ReadMap {
  if (value === undefined) return { kind: "absent" };
  if (!isPlainRecord(value)) return { kind: "carried", value };
  const names = boundedOwnKeys(value, MAX_ENVELOPE_ENTRIES);
  if (names === null) return { kind: "carried", value };
  const slots: Record<string, unknown> = {};
  // DEFINED rather than assigned: a stored record may carry an own `__proto__`,
  // and assigning to it runs the inherited setter instead of making a property.
  for (const name of names) {
    defineEntry(slots, name, readSlot(value[name], named));
  }
  return { kind: "read", slots };
}

/** One nominated property, each field taken exactly once. */
function readProperty(one: unknown, named: string[]): unknown {
  if (!isPlainRecord(one)) return one;
  const nodeId = one.nodeId;
  if (typeof nodeId === "string") named.push(nodeId);
  const options = one.options;
  return {
    id: one.id,
    label: one.label,
    nodeId,
    propPath: one.propPath,
    type: one.type,
    ...(options === undefined
      ? {}
      : { options: nestedValue(readEntries(options, readOption)) }),
  };
}

/** One `select` option, copied so the caller cannot edit the plan afterwards. */
function readOption(one: unknown): unknown {
  return isPlainRecord(one) ? { ...one } : one;
}

/** One nominated slot region, each field taken exactly once. */
function readSlot(one: unknown, named: string[]): unknown {
  if (!isPlainRecord(one)) return one;
  const nodeId = one.nodeId;
  if (typeof nodeId === "string") named.push(nodeId);
  const allow = one.allow;
  return {
    label: one.label,
    nodeId,
    slot: one.slot,
    ...(allow === undefined
      ? {}
      : { allow: nestedValue(readEntries(allow, entry => entry)) }),
  };
}

/**
 * A nomination naming a source id the selection holds TWICE.
 *
 * The save re-mints ids one per node, but the map it returns is keyed on the
 * ORIGINAL id — so two nodes sharing one lose the first mapping to the second,
 * and a pointer re-aimed through it lands on whichever copy came last. The
 * stored document is well formed and the envelope check passes, because the
 * pointer does resolve; it simply resolves to a node the author did not choose,
 * and every instance override then edits the wrong block.
 *
 * Refused rather than resolved, because the nomination is genuinely ambiguous:
 * two nodes answered to the name the author gave, and nothing here can know
 * which was meant. The same stance `"duplicate-destination"` takes elsewhere.
 *
 * Only the ids actually NOMINATED. A duplicate somewhere else in the selection
 * is a property of the page, which is saved under forgiving validation and may
 * legitimately hold one — refusing on it would reject a component whose every
 * exposure is unambiguous.
 *
 * Asked of the READ request, so the id it judges is the id that will be stored.
 */
function ambiguousNomination(
  selected: readonly BlockNode[],
  read: ReadExposure
): PlanRefusal | undefined {
  const roots = [...selected];
  for (const id of read.named) {
    if (countById(roots, id) > 1) return { problem: "ambiguous-exposure" };
  }
  return undefined;
}

/** Whether either collection is one nothing may read. */
function unreadable(read: ReadExposure): boolean {
  return (
    read.properties.kind === "unreadable" || read.slots.kind === "unreadable"
  );
}

/**
 * Why the completed definition could not be stored, or `undefined`.
 *
 * Two questions the envelope check does not answer, asked of the document WITH
 * its envelope on.
 *
 * Whether it can be stored at all — `savedPatternDocument` asks that of the
 * tree, before there is an envelope, and the envelope is caller-supplied, so a
 * field the envelope check does not read can still make the whole document
 * unwritable.
 *
 * And whether it FITS. An exposure only ever makes a document bigger, so a page
 * inside the caller's caps can become a definition that is not — and being
 * editable is a different question from being small enough. Measured through
 * the survey the publish gate uses, so the two cannot come to disagree about
 * the size of one document.
 */
function definitionRefusal(
  definition: ComponentDocument,
  limits: DocumentLimits
): PlanRefusal | undefined {
  if (documentRefusal(definition) !== undefined) {
    return { problem: "unusable-document" };
  }
  const survey = surveyDocument(definition, limits);
  if (survey.tooLarge || survey.tooDeep || survey.tooManyNodes) {
    return { problem: "exceeds-limits" };
  }
  return undefined;
}

/**
 * The nominated properties, re-aimed at the stored tree.
 *
 * Absent rather than an empty array when nothing was nominated, matching what
 * {@link ComponentDocument.exposed} says absence means. Writing `[]` would
 * store a field to say what its absence already says, and make two saves of one
 * selection differ by whether the caller passed a list it had not filled.
 */
function exposedProperties(
  read: ReadExposure,
  nodeIds: ReadonlyMap<string, string>
): { exposed?: ExposedProperty[] } {
  const properties = read.properties;
  if (properties.kind === "absent" || properties.kind === "unreadable") {
    return {};
  }
  if (properties.kind === "carried") {
    return { exposed: properties.value as ExposedProperty[] };
  }
  if (properties.entries.length === 0) return {};
  const exposed: ExposedProperty[] = [];
  for (const one of properties.entries) {
    exposed.push(aimedProperty(one, nodeIds));
  }
  return { exposed };
}

/** One read property, with its pointer moved onto the stored node. */
function aimedProperty(
  one: unknown,
  nodeIds: ReadonlyMap<string, string>
): ExposedProperty {
  if (!isPlainRecord(one)) return one as ExposedProperty;
  return { ...one, nodeId: storedId(one.nodeId, nodeIds) } as ExposedProperty;
}

/** The nominated slot regions, re-aimed, on the same terms as the properties. */
function exposedSlots(
  read: ReadExposure,
  nodeIds: ReadonlyMap<string, string>
): { slots?: Record<string, ExposedSlot> } {
  const requested = read.slots;
  if (requested.kind === "absent" || requested.kind === "unreadable") {
    return {};
  }
  if (requested.kind === "carried") {
    return { slots: requested.value as Record<string, ExposedSlot> };
  }
  const names = Object.keys(requested.slots);
  if (names.length === 0) return {};
  const slots: Record<string, ExposedSlot> = {};
  for (const id of names) {
    defineEntry(slots, id, aimedSlot(requested.slots[id], nodeIds));
  }
  return { slots };
}

/** One read slot, with its pointer moved onto the stored node. */
function aimedSlot(
  one: unknown,
  nodeIds: ReadonlyMap<string, string>
): ExposedSlot {
  if (!isPlainRecord(one)) return one as ExposedSlot;
  return { ...one, nodeId: storedId(one.nodeId, nodeIds) } as ExposedSlot;
}

/**
 * A source node id, as the stored document spells it.
 *
 * An id with no entry in the map is returned UNCHANGED rather than dropped or
 * replaced. It names a node outside the selection, and leaving it makes the
 * envelope check report it as the dangling pointer it is — one rule, asked
 * once, in the module that owns it. Dropping it would silently discard a
 * property the author nominated and tell them the save succeeded.
 *
 * It cannot collide with a real stored id by accident: the save mints fresh
 * ones, so a surviving source id is never one of them.
 */
function storedId(
  sourceId: unknown,
  nodeIds: ReadonlyMap<string, string>
): unknown {
  if (typeof sourceId !== "string") return sourceId;
  return nodeIds.get(sourceId) ?? sourceId;
}

/**
 * Take the run off the page and put one instance where it stood.
 *
 * Asked of the document as it stands BEFORE the removes, which is what the ops
 * will meet: the container has to exist and be unambiguous when the group is
 * applied, and the group is applied to this document.
 */
function replaceOps(
  document: BlockDocument,
  saved: PlannedSave,
  componentId: string,
  nesting: NestingSource,
  limits: DocumentLimits
): RestampOps | PlanRefusal {
  // Everything `applyOp` asks BEFORE it looks at an op — the envelope, then the
  // whole forest, because it walks every node before applying anything. A
  // malformed sibling the author never selected refuses the first remove of a
  // group whose library row has already been written, which is the rollback the
  // plan/apply split exists to avoid. Asked exactly as {@link restampOps} asks
  // it, since both planners emit ops against the same document.
  if (
    documentRefusal(document) !== undefined ||
    forestRefusal(document.nodes) !== undefined
  ) {
    return { problem: "unusable-document" };
  }

  const refusal =
    lockRefusal(saved.selected) ?? removableRefusal(document, saved.selected);
  if (refusal !== undefined) return refusal;

  const position = replacementPosition(saved.at);
  if (position.problem !== undefined) return position;

  const instance: BlockNode = {
    id: newId(),
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId },
  };

  // The insert path's own resolution, rather than a second reading of the same
  // position: it asks the op layer whether the position names anywhere, finds
  // the container once, and hands back the parent TYPE the nesting rule needs.
  const destination = destinationOf(document, position.at);
  if (destination.problem !== undefined) return destination;

  // Asked of the INSTANCE, not of the blocks it replaces. They are not the node
  // going in, and a slot that accepted a heading need not accept a component.
  const placement = placementRefusal(
    [instance],
    destination.place.where,
    nesting
  );
  if (placement !== undefined) return placement;

  const ops: BuilderOp[] = [
    ...saved.selected.map(
      (root): BuilderOp => ({ kind: "remove", id: root.id })
    ),
    { kind: "insert", node: instance, at: position.at },
  ];

  // The BYTE cap, asked of the apply, because the apply is the only place that
  // can answer it. `nodeShapeRefusal` says so in as many words: `assertFitsCaps`
  // measures the document a node is going INTO, so a subtree with no
  // destination cannot be judged against it. A run replaced by a larger
  // instance can cross a cap the page was inside, and the plan would be handed
  // over with its library row already written.
  //
  // Applied to a copy rather than re-derived: `applyOps` is pure, and a second
  // reading of the same rule is one more thing that can come to disagree with
  // the run it predicts.
  try {
    applyOps(document, ops, limits);
  } catch {
    return { problem: "exceeds-limits" };
  }

  return { ops };
}

/**
 * A selected root this document will not let a `remove` take.
 *
 * The op layer's own rule rather than a count of the root's id, and the two are
 * not the same question: `remove` refuses when ANY id inside the subtree it
 * takes occurs more than once in the document, because the inverse it records
 * could not put that subtree back. A root can be unique while a node three
 * levels down collides with something across the page — and the plan then
 * succeeds, the library row is written, and the first op throws.
 */
function removableRefusal(
  document: BlockDocument,
  roots: readonly BlockNode[]
): PlanRefusal | undefined {
  for (const root of roots) {
    if (subtreeRemovalRefusal(document.nodes, root) !== undefined) {
      return { problem: "duplicate-destination" };
    }
  }
  return undefined;
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
function ambiguousRootRefusal(
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

/** Where the replacement goes, or why the run names nowhere to put it. */
interface ReplacementPosition {
  readonly at: OpPosition;
  readonly problem?: undefined;
  readonly permitted?: undefined;
  readonly issues?: undefined;
}

/**
 * The run's own place, as the position an op would put something back at.
 *
 * The narrowing {@link RunPlacement} deliberately does not do, in the one place
 * that has to commit to an answer. `contiguousRun` sets the two container
 * fields together or leaves both, so a parent named without its slot is a shape
 * it does not emit — but the fields are independently optional in its result,
 * and guessing which half to believe would either move a block to the top level
 * or address a slot nobody named. Refused as what it is instead, through the
 * cause `applyOp` would give the position it cannot be built into.
 */
function replacementPosition(
  at: RunPlacement
): ReplacementPosition | PlanRefusal {
  if (at.parentId === undefined) return { at: { index: at.index } };
  if (at.slot === undefined) return { problem: "invalid-position" };
  return { at: { parentId: at.parentId, slot: at.slot, index: at.index } };
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
  const marked = withOrigin(
    copy.nodes,
    insertOrigin(
      pattern.id,
      patternDigest(pattern.document.nodes),
      copy.renamed
    )
  );

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
  /**
   * Each DOM id the copy had to change, as the source spells it → as the copy
   * does. Empty when the destination held none of them.
   */
  readonly renamed: ReadonlyMap<string, string>;
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

function freshCopy(
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
    if (!clash) return { nodes: minted.nodes, renamed: minted.domIds };
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
function domIdsIn(nodes: BlockNode[]): Set<string> {
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
function walkRenderedIds(
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

/**
 * The provenance record an insert writes, carrying what it had to rename.
 *
 * `renamed` is omitted when nothing moved rather than written empty, matching
 * every other "absent means none" field in this contract — and making a copy
 * that renamed nothing byte-identical to one taken before this was recorded.
 */
function insertOrigin(
  patternId: string,
  digest: string,
  renamed: ReadonlyMap<string, string>
): BlockOrigin {
  return {
    from: "pattern",
    id: patternId,
    digest,
    ...(renamed.size === 0 ? {} : { renamed: Object.fromEntries(renamed) }),
  };
}

/**
 * The DOM ids a saved run should be stored under, as it spells them → as its
 * source does.
 *
 * Built from the roots' own provenance, so a run assembled from two different
 * inserts restores each half against the pattern it came from. A root with no
 * record contributes nothing and keeps every id it carries: nothing renamed it,
 * so there is nothing to put back.
 *
 * INVERTED from the record, which reads source → copy because that is the
 * direction an insert renames in.
 *
 * Two copies of ONE pattern in a single selection can both restore to the same
 * id, and the save then refuses as `"duplicate-dom-id"`. That is the honest
 * answer: the run really does hold two elements the source names identically,
 * and storing them under their minted names would put two ids nobody wrote into
 * a library, each to be suffixed again on the next insert.
 */
function restoredDomIds(
  selected: readonly BlockNode[]
): ReadonlyMap<string, string> {
  const restore = new Map<string, string>();
  for (const root of selected) {
    const origin = root.origin;
    if (origin === undefined || origin.from !== "pattern") continue;
    const renamed = origin.renamed;
    if (renamed === undefined) continue;
    for (const [was, now] of Object.entries(renamed)) restore.set(now, was);
  }
  return restore;
}
