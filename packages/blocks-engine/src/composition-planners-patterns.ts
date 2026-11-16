/**
 * Saving a selection as a pattern: the run a selection makes, the pattern
 * document it is stored as, and updating a pattern from a new selection.
 *
 * @module composition-planners-patterns
 */
import type {
  CreatePlanResult,
  LibraryTarget,
  PatternUpdateTarget,
  PlanRefusal,
  PlanResult,
} from "./composition-planners-contract";
import {
  nodeOrigin,
  recordedOrigin,
  restorePolicy,
  withoutOrigin,
} from "./composition-planners-provenance";
import {
  ambiguousRootRefusal,
  duplicateDomIdRefusal,
  internalNestingRefusal,
  overIndexBound,
  placementRefusal,
  shapeRefusal,
} from "./composition-planners-refusals";
import type { BlockDocument, BlockNode } from "./document";
import { DEFAULT_LIMITS, type DocumentLimits } from "./limits";
import { surveyDocument } from "./measure-bytes";
import type { NestingSource } from "./nesting";
import { type BuilderOp, documentRefusal, forestRefusal } from "./ops";
import { patternDigest } from "./pattern-digest";
import { contiguousRun } from "./sibling-run";
import { reidForestWithMap } from "./tree";

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
): CreatePlanResult<TFields> {
  const saved = plannedSave(document, selectedIds, nesting);
  if (saved.problem !== undefined) return saved;

  return {
    create: {
      collection: target.collection,
      document: saved.stored,
      fields: target.fields,
    },
    pageOps: [],
    warnings: [],
  };
}

/** A selection, validated, and the pattern document it becomes. */
export interface PlannedSave {
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
export function plannedSave(
  document: BlockDocument,
  selectedIds: readonly string[],
  nesting: NestingSource,
  // THREADED, not defaulted here. A host may RAISE `maxNodes`, and a document
  // legitimate under a raised cap must not be refused by a bound this file
  // chose for itself — the same reason the envelope index is built under the
  // host's cap rather than the default.
  limits: DocumentLimits = DEFAULT_LIMITS
): PlannedSave | PlanRefusal {
  // The one thing the SOURCE has to be for the search to happen at all: a list
  // of roots. `contiguousRun` walks `document.nodes` to locate the selection, so
  // a document whose `nodes` is absent or is not a list fails there as a native
  // `TypeError` rather than as the refusal this returns — and that difference
  // reaches a caller. A route reports it as a server fault instead of a bad
  // request, and the published preflight throws where it promised a verdict, so
  // a toolbar asking whether a save is possible crashes instead of disabling a
  // button.
  //
  // Deliberately NOT `documentRefusal`, which is what `planInsertPattern` asks
  // of the document it EDITS. That one also judges the source's `formatVersion`
  // and `kind`, and a save reads neither: `kind` is written here, so a page
  // whose own kind is unreadable still yields a perfectly good pattern —
  // {@link savedPatternDocument} says so, and refusing it would be asking about
  // the origin rather than about the thing.
  //
  // Not `forestRefusal` either, which walks every entry. An insert applies ops
  // across the whole forest, so a malformed node the selection never touched
  // still throws on apply; a save applies nothing to the page, and refusing on
  // rubbish elsewhere would stop an author rescuing the part of their page that
  // is still good. Measured: a `null` beside good roots already answers rather
  // than throwing.
  if (!Array.isArray(document.nodes)) return { problem: "unusable-document" };

  const run = savableRun(document, selectedIds, nesting);
  if (run.problem !== undefined) return run;

  const stored = savedPatternDocument(document, run.selected, limits);
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
 * optional — rather than as an `OpPosition`, which ties them together.
 * Narrowing here would mean deciding what a half-set container MEANS at the
 * point that has the least to go on, and the honest answer is that it is not a
 * position at all. `replaceOps` refuses it as one.
 */
export interface RunPlacement {
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
  selected: readonly BlockNode[],
  limits: DocumentLimits
): SavedPattern | PlanRefusal {
  // KEEP every id, except the ones an insert renamed to fit this page: those
  // go back to what the source calls them. The two are one policy rather than a
  // second pass, so node ids are minted once and the map this returns still
  // describes the document it comes with.
  const restore = restorePolicy(document, selected, limits);
  if ("problem" in restore) return restore;
  const copied = reidForestWithMap([...selected], restore.policy);
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

  // The stored document against the caps it will be WRITTEN under. Asked of
  // what is stored rather than of the page, like the questions either side of
  // it: only some of what the page holds travels, so a selection lifted out of
  // a document at its ceiling is usually well within one.
  //
  // Without this a plan succeeded and the write then failed. The blocks field
  // validates what it is handed, so a pattern over the byte cap or deeper than
  // the depth cap is refused there — after the author has named it, filled the
  // form and pressed save. Refusing at plan time is the same verdict, arriving
  // where they can still do something about it, and it is what lets the
  // published preflight promise that a save it permits will not fail on size.
  const storedSurvey = surveyDocument(stored, limits);
  if (storedSurvey.tooLarge || overIndexBound(storedSurvey)) {
    return { problem: "exceeds-limits" };
  }

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
 * `PlannedUpdate` carries no fields for a caller to overwrite them with.
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
    warnings: [],
  };
}

/** The updates that bring the saved-over run back in sync, or why they cannot. */
export interface RestampOps {
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
  // The record is CARRIED out of the filter, not read again in the map below.
  // A stored node can be a Proxy, and two reads of one descriptor can answer
  // differently — so re-reading would let the record that decided a root was
  // stale and the record whose rename map gets restamped onto it be two
  // different records.
  const stale = selected.flatMap(root => {
    const origin = nodeOrigin(root).origin;
    if (origin === undefined || origin.from !== "pattern") return [];
    if (origin.id !== patternId || origin.digest === digest) return [];
    return [{ root, origin }];
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
  const ambiguous = ambiguousRootRefusal(
    document,
    stale.map(({ root }) => root)
  );
  if (ambiguous !== undefined) return ambiguous;

  return {
    ops: stale.map(({ root, origin }) => ({
      kind: "update",
      id: root.id,
      // The rename map is CARRIED, not dropped. This op rewrites the whole
      // record, and the ids this copy carries are still the renamed ones — the
      // save put them back in the PATTERN, not on the page. Dropping the map
      // left the next save of the same copy with nothing to restore, so the
      // page-specific suffix went into the pattern and the insert-save cycle
      // resumed growing it. The round trip held once and failed on the second
      // pass, which is why a test that never applied these ops could not see it.
      //
      // The node lists travel with it, verbatim. A list naming a node that has
      // since gone is still what the insert did, and pruning it here would be
      // this save deciding the rename is over; a record without lists stays
      // without, since inventing them would pick a node for a record that
      // never said which.
      patch: {
        origin: recordedOrigin(patternId, digest, origin),
      },
    })),
  };
}
