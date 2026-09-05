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
import type { BuilderOp } from "./ops";
import { contiguousRun, type RunProblem, type SiblingRun } from "./sibling-run";
import { findNode, reidForestWithMap } from "./tree";

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
}

/**
 * A plan, or the cause there is none.
 *
 * Carries the cause from {@link contiguousRun} unchanged, so the sentence shown
 * to an author is composed once per surface rather than once per planner.
 */
export type PlanResult<TFields> =
  | CompositionPlan<TFields>
  | {
      readonly problem: RunProblem;
      readonly create?: undefined;
      readonly pageOps?: undefined;
    };

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
  target: PatternTarget<TFields>
): PlanResult<TFields> {
  const result = contiguousRun(document.nodes, selectedIds);
  if (result.run === undefined) return { problem: result.problem };

  const selected = runNodes(document.nodes, result.run);
  if (selected === undefined) return { problem: "unknown" };

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
 * The selected nodes themselves, in document order.
 *
 * Each is fetched by ITS OWN id, never by re-resolving the run's parent and
 * indexing into its slot. That reads like the same thing and is not, on a
 * stored document nothing validated: two nodes may share an id, and then the
 * parent `siblingRun` located a child under is not the parent a later lookup by
 * that id returns — the first one is. The indexes were then read from the wrong
 * container and the pattern was saved from blocks the author never selected,
 * with nothing to show it. Measured on a document with two parents called
 * `"dup"`: selecting the second parent's two children saved the FIRST parent's.
 *
 * Asking for each node by name removes the second lookup that could disagree.
 * `findNode` and the `locateNode` behind `siblingRun` both answer with the
 * first match in one forest walk, so they cannot resolve one id differently.
 *
 * `undefined` when a node cannot be read back at all, which is unreachable
 * after {@link contiguousRun} has just located every one of them — reported
 * rather than trusted, because a planner that skipped a hole would build a
 * pattern quietly missing a block.
 */
function runNodes(
  nodes: BlockNode[],
  run: SiblingRun
): BlockNode[] | undefined {
  const selected: BlockNode[] = [];
  for (const place of run.places) {
    const node = findNode(nodes, place.id);
    if (node === undefined) return undefined;
    selected.push(node);
  }
  return selected;
}
