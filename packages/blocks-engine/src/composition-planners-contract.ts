/**
 * What a composition plan is made of: the library row to create or update,
 * the warnings and problems a plan can carry, the result shapes every planner
 * returns, and the targets a caller hands in — a library collection, a
 * pattern to update, a stored pattern and where to insert it.
 *
 * @module composition-planners-contract
 */
import type { BlockDocument } from "./document";
import type { NestingRefusal } from "./nesting";
import type { BuilderOp, OpPosition } from "./ops";
import type { RunProblem } from "./sibling-run";
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
/**
 * A consequence of a plan the author should be told about, which is not a
 * reason to refuse it.
 *
 * Warnings ride ALONGSIDE a successful plan, and a caller that ignores them
 * still gets a correct apply. That split is the same one a dry run makes
 * everywhere it is done well — `terraform plan` reports diagnostics whose
 * severity decides whether execution halts, and the Kubernetes API server
 * returns advisory warnings on a successful response with the explicit rule
 * that nothing automated may act on them.
 *
 * It lives on the PLAN rather than in whichever surface offers the action, for
 * the reason every other foreseeable consequence does: the plan IS the dry run.
 * A surface computing it separately would ask a question the planner already
 * has the answer to, and the second surface to offer the same action would have
 * to remember to ask it.
 */
export type PlanWarning = OrphanedAnchorWarning;

/**
 * The plan moves a block that renders a DOM id, and something still on the page
 * links to it.
 *
 * Converting a run to a component moves its nodes into a definition, and
 * composition scopes every definition-authored id per instance — it has to,
 * because two instances of one definition cannot both answer to one `id`. So an
 * author who wrote `id="pricing"` on a section, with `href="#pricing"` in a nav
 * elsewhere on the page, is left with a link that resolves to nothing.
 *
 * Inherent rather than a defect, which is why it warns and does not refuse: no
 * scoping rule makes one id serve many instances, and the author may well want
 * the component anyway. Webflow has the same shape and reports it only when
 * someone notices the link has stopped working; Gutenberg met it from the other
 * side, where duplicating a block duplicated its anchor and put one id on the
 * page twice.
 *
 * A reference from INSIDE the run is not reported. Those move together and the
 * relink pass rewrites them, so they keep working — it is only a reference the
 * conversion leaves behind that breaks.
 */
export interface OrphanedAnchorWarning {
  readonly kind: "orphaned-anchor";
  /** The rendered DOM id that will stop being addressable. */
  readonly domId: string;
  /**
   * The page ROOTS whose subtrees still reference it, in document order.
   *
   * Roots rather than the linking node itself, and the name says so. The one
   * walk that answers "which of these ids does this subtree reference" —
   * `referencedDomIds` — runs the relink pass with an instrumented candidate
   * map, so a hit is attributed to the root being walked and the node is not in
   * hand when it is recorded. Narrowing to the node would mean a relink pass
   * per node, which is the traversal cost multiplied by the page.
   *
   * Enough for the sentence a surface has to write: it names where to look.
   */
  readonly referencingRoots: readonly string[];
}

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
  /**
   * What the author should know before applying it, empty when there is
   * nothing.
   *
   * Always an array and never absent, so "no warnings" and "this planner does
   * not produce them" are the same observable value rather than two a caller
   * has to tell apart. An optional field would make the second expressible, and
   * a surface reading it would have to decide what an absence meant.
   */
  readonly warnings: readonly PlanWarning[];
  readonly problem?: undefined;
  // Declared on the success member too, so a caller reads either field off the
  // union without narrowing first and cannot read a refusal's detail off a plan.
  readonly permitted?: undefined;
  readonly issues?: undefined;
}

/**
 * A plan, or the cause there is none.
 *
 * Carries the cause from `contiguousRun` unchanged, so the sentence shown
 * to an author is composed once per surface rather than once per planner.
 */
/**
 * Why a composition action cannot be planned.
 *
 * The selection causes come from `contiguousRun` unchanged. The nesting
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
  | "not-a-component"
  /**
   * A gated instance whose content carries gates of its own.
   *
   * Its own cause because nothing is malformed and the remedy is the author's:
   * the instance is shown conditionally and so is something the component
   * draws, and the two sets of conditions cannot be combined into one without
   * rewriting rules nobody asked to change.
   */
  | "condition-gated"
  /**
   * The placement left on the page would nest components, or blocks, deeper
   * than the page may compose.
   *
   * Its own cause because the selection is valid as a component of its own:
   * what breaks is the page once the run becomes one more level of nesting,
   * so the author's remedy is a smaller or shallower selection.
   */
  | "composed-depth";

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
  readonly warnings?: undefined;
}

export type PlanResult<TFields> = CompositionPlan<TFields> | PlanRefusal;

/**
 * A plan that is guaranteed to have created something, or the cause it did not.
 *
 * {@link CompositionPlan.create} is optional because a composition action need
 * not create anything — `planDetach` only edits the page — so the shared shape
 * cannot promise a row. A planner whose whole purpose is to fill the library
 * always does, and saying so in the type is what stops every caller writing a
 * branch for a state its planner cannot reach: an impossible branch is one that
 * can never be exercised, so nothing ever proves it does the right thing, and
 * the first reader to simplify it has no way to tell whether it was defensive
 * or load-bearing.
 *
 * It narrows nothing else, and it is applied per planner rather than to a group
 * of them. Each planner's guarantee is its own — a `create` here, a `create` and
 * `pageOps` for a convert, an `update` for a save-over — and one alias spanning
 * them would assert whichever guarantee its name suggested for planners that
 * were never checked against it.
 */
export type CreatePlanResult<TFields> =
  | (CompositionPlan<TFields> & { readonly create: PlannedCreate<TFields> })
  | PlanRefusal;

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
 * Where a run sat in the document it was selected from.
 *
 * Reported as the run gave it — the two container fields independently
 * optional — rather than as an {@link OpPosition}, which ties them together.
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
