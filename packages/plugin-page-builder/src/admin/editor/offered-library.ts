/**
 * Which saved components and patterns the insert panel may offer while a
 * component's own definition is being edited.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/offered-library
 */
import {
  componentReach,
  componentReachIn,
  componentReferencesFrom,
  componentReferencesIn,
  isComponentDocument,
  type BlockDocument,
  type ComponentLookup,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import type { SavedComponent, SavedPattern } from "@nextlyhq/builder";

/**
 * The components a field may OFFER: every one the library holds, except the
 * one whose own definition this field is editing and every one that reaches
 * it.
 *
 * A component's content field is a blocks field like a page's, and the library
 * it reads includes the very row being edited — whose saved definition does
 * not yet hold the reference an author is about to place, so nothing in the
 * offer refuses it. Placed, the instance points at the definition it sits in;
 * saved, the resolver reads the loop as a cycle and draws a placeholder. The
 * row is left out here, where the field knows which document it is inside.
 *
 * The row itself is the shortest loop, not the only one. A component that
 * holds an instance of this one, placed here, closes the loop one step out;
 * one that holds THAT closes it two steps out. None is visible against the
 * saved map until this row is saved, and then every page placing any of them
 * draws a placeholder. So a candidate is judged by its STORED graph: which
 * components its definition names, and which those name, followed through
 * the canvas's own lookup until this row is met or nothing is left. A walk
 * over the graph rather than a composition of every row, for two reasons.
 * A loop is a loop whatever one render happens to skip — an instance under
 * an entry-field gate is served when its condition holds, and a chain past
 * the composition cap is refused at render, not absent — so what a render
 * READS under-answers the question. And composing three thousand rows to
 * ask it clones every definition each row reaches, once per row.
 *
 * Whether the edit is inside a component at all is `editedComponentId`.
 *
 * Every read of the graph is bounded by the SITE's node cap, and a read the
 * cap ends early is not "names nothing" — it is unread, and the candidate is
 * left out; so is one whose graph reaches an id the lookup does not hold out
 * of a library that was not read whole (`namedBy`).
 *
 * The pattern tier is filtered by the same rule and the same graph —
 * {@link withoutSelfPatterns}.
 *
 * Exported for its own test, for the reason `documentFrom` is.
 */
export function withoutSelf(
  components: readonly SavedComponent[],
  editing: BlockDocument,
  identity: { documentId?: string | undefined } | null,
  graph: ComponentGraph
): readonly SavedComponent[] {
  const self = editedComponentId(editing, identity);
  if (self === undefined) return components;
  const kept = components.filter(
    component =>
      component.id !== self && !reachesFrom([component.id], self, graph)
  );
  // The same list when nothing was removed, so the panel's catalogue memo
  // keeps its key.
  return kept.length === components.length ? components : kept;
}

/**
 * The patterns the panel may OFFER, by the same rule and the same graph.
 *
 * A pattern is a second way to copy a component into itself. Saving a
 * selection keeps the nodes it held, and an instance node is one of them —
 * so a pattern saved from a page that placed A carries an instance of A, and
 * a pattern that places B carries A wherever B's definition reaches it. The
 * component tier being filtered says nothing about either: they are
 * different rows, out of a different collection, read by a different query.
 *
 * Left OUT rather than refused at the click, because the panel is where an
 * author decides. A tile offered and then refused reads as a bug in the
 * pattern; a tile that is not there while a component is open is the same
 * sentence the component tier already tells.
 *
 * What a pattern names is read from the row's OWN document — there is no
 * lookup entry to read it from — and everything past that first step is the
 * component graph, walked exactly as {@link withoutSelf} walks it, from the
 * same lookup the canvas resolves against.
 */
export function withoutSelfPatterns(
  patterns: readonly SavedPattern[],
  editing: BlockDocument,
  identity: { documentId?: string | undefined } | null,
  graph: ComponentGraph
): readonly SavedPattern[] {
  const self = editedComponentId(editing, identity);
  if (self === undefined) return patterns;
  const kept = patterns.filter(
    pattern => !reachesFrom(namesOf(pattern, graph.limits), self, graph)
  );
  return kept.length === patterns.length ? patterns : kept;
}

/**
 * The components a stored pattern places directly, or `undefined` when that
 * cannot be told — which counts as reaching, for the reason {@link namedBy}
 * gives: a prefix the node cap ended early names nothing, and so does a
 * pattern nobody could read.
 *
 * A row carrying no document at all is not that case. The collection does not
 * mark its blocks field required, so a titled row with no content is a legal
 * row; it places nothing, and the catalogue skips it on its own.
 */
function namesOf(
  pattern: SavedPattern,
  limits: DocumentLimits
): readonly string[] | undefined {
  const nodes = pattern.document?.nodes;
  if (nodes === undefined) return [];
  // The reachability question, not the stored-ids one, for the reason
  // {@link namedBy} gives. A pattern declares no variants today, so the two
  // answers coincide here — asked this way they cannot come apart if one ever
  // does.
  const usage = componentReferencesIn(pattern.document, limits.maxNodes);
  return usage.complete ? usage.ids : undefined;
}

/**
 * The component this field is editing, or `undefined` when it is not editing
 * one.
 *
 * Judged by BOTH facts: the document being edited is a component, and the
 * form names the row. Either alone is not enough — a page's field is never
 * inside a component however the ids fall, and a component's field on a
 * create form names no row yet and can place anything.
 *
 * Stated once because two filters ask it, and a rule spelled twice is one
 * that will eventually differ between the tier that is filtered and the tier
 * that is not.
 */
function editedComponentId(
  editing: BlockDocument,
  identity: { documentId?: string | undefined } | null
): string | undefined {
  const self = identity?.documentId;
  return self !== undefined && isComponentDocument(editing) ? self : undefined;
}

/** What judging a candidate's graph reads. */
export interface ComponentGraph {
  /** The lookup the canvas resolves against; each walk starts from its copy. */
  readonly definitions: ComponentLookup;
  /** The site's caps: every read of a definition is bounded by its node cap. */
  readonly limits: DocumentLimits;
  /**
   * Whether the library read was WHOLE. A read the ceiling or a permission
   * cut leaves out rows the store holds, so an id the lookup does not hold
   * may be one of them — and may name the definition being edited.
   */
  readonly whole: boolean;
}

/**
 * Whether the graph grown from these components names the definition given,
 * at any depth, through the lookup — or cannot be shown not to.
 *
 * The seeds are what a candidate places directly: one id for a component row,
 * every id its document places for a pattern. `undefined` is a seed list
 * nobody could read, which counts as reaching for the reason {@link namedBy}
 * gives.
 *
 * Each definition is read once per question, the seeds' own included — a loop
 * among other rows ends where it began rather than running on — and from the
 * lookup's copy, which is what the canvas will draw.
 */
function reachesFrom(
  seeds: readonly string[] | undefined,
  id: string,
  graph: ComponentGraph
): boolean {
  // The ENGINE's walk, not a second one. The same question is asked at the
  // write — whether a component's references lead back to it — and two
  // traversals of one graph drift in their ordering, their handling of a
  // definition nobody could read, and whatever the graph learns to mean next.
  //
  // Projected to a boolean here, which is what an OFFER needs: a chain that
  // closes and a definition that could not be read both mean "do not offer
  // this", because withholding one tile is the cheap direction. The write
  // spends the same uncertainty differently, which is why the verdict keeps the
  // two apart and each caller decides.
  //
  // The lookup is memoised for the DURATION of this question. Resolving a
  // placement's overrides reads the definition being placed, and the walk then
  // visits that same definition — so without this a definition is read twice per
  // question, and one placed by many others once per placer. Held here rather
  // than on the graph so it cannot outlive a question and answer a later one
  // from a library that has since been re-read.
  const held = new Map<string, BlockDocument | undefined>();
  const once: ComponentLookup = {
    has: candidate => graph.definitions.has(candidate),
    get: candidate => {
      if (!held.has(candidate))
        held.set(candidate, graph.definitions.get(candidate));
      return held.get(candidate);
    },
  };

  return (
    componentReach({
      places: seeds,
      self: id,
      placedBy: candidate =>
        namedBy(candidate, { ...graph, definitions: once }),
    }).kind !== "none"
  );
}

/**
 * The components one definition names, or `undefined` when that cannot be
 * told — which counts as reaching, and leaves the candidate out.
 *
 * Two reads cannot tell. One the node cap ended early answered with a
 * PREFIX: a reference past it is invisible, so "names nothing" is what an
 * unread definition looks like too. And an id the lookup does not hold, out
 * of a library that was not read whole, may be a component the cut left out.
 * Out of a WHOLE library the same id is one nobody supplied: it names nothing
 * further, and the resolver draws it as missing. Failing closed refuses no
 * legitimate offer — a definition the cap cannot read whole is one the
 * resolver cannot inline under it either, and an author editing a component
 * against a cut library is told the library was cut — and it is the
 * direction to err in, because the other one is a saved loop every page then
 * draws as a placeholder.
 */
function namedBy(
  id: string,
  { definitions, limits, whole }: ComponentGraph
): readonly string[] | undefined {
  const definition = definitions.get(id);
  if (definition === undefined) return whole ? [] : undefined;
  // What the definition can REACH, variants included, which is the same rule
  // the write guard judges a save by. The stored ids alone would have the panel
  // offer a component whose variant re-points a nested instance back at the one
  // being edited — an insert the author is invited to make and the save then
  // refuses.
  // An APPROXIMATION of composition, deliberately. The WRITE asks the renderer
  // itself, which cannot be afforded here: this filters every candidate in a
  // library sized at three thousand entries, and composing each one is not a
  // render-time cost. So this folds in what a definition's own variants install
  // and what a placement installs on the definition it places, and is short by
  // one level for every further level of nesting overrides flow through.
  //
  // The consequence is that this can OFFER a tile whose save the write refuses —
  // a trap rather than a corruption, since the write is exact. Closing it means
  // composing the ONE candidate being inserted rather than every candidate in
  // the filter, which is affordable where composing the list is not.
  //
  // ONE walk for both: the ids the definition reaches, and the nodes it reaches
  // through. The second is the edge that belongs to the PLACEMENT — a node here
  // may carry overrides aimed at the exposures of the component IT places, which
  // re-point one of that component's own nested instances. Neither document
  // names it alone, so each placement is resolved against the definition it
  // places, from the lookup already in memory. That is why the panel can ask
  // synchronously where the write has to read.
  const survey = componentReachIn(definition, limits.maxNodes);
  if (!survey.complete) return undefined;

  const ids = new Set<string>(survey.ids);
  const resolved = new Map<string, BlockDocument | undefined>();
  for (const placement of survey.placements) {
    // One lookup per TARGET, not per placement: a definition that places the
    // same component five times asks about it once.
    if (!resolved.has(placement.target)) {
      resolved.set(placement.target, definitions.get(placement.target));
    }
    const target = resolved.get(placement.target);
    // A definition the lookup does not hold says nothing about what an override
    // on it would install. SKIPPED rather than answered as unknown here: the
    // target is already among the ids this returns, so the walk visits it and
    // reports the uncertainty there. Answering unknown twice for one gap makes
    // the panel withhold a tile for a definition it could read perfectly well.
    if (target === undefined) continue;
    const installed = componentReferencesFrom(
      target,
      placement.node,
      limits.maxNodes
    );
    // A definition too large to index cannot say what an override installs on
    // it. SKIPPED here for the same reason an absent one is, and not treated as
    // unknown: the target is already among the ids this returns, so the walk
    // visits it and reports the uncertainty once, there.
    if (!installed.complete) continue;
    for (const reached of installed.ids) ids.add(reached);
  }
  return [...ids];
}
