/**
 * Which named classes a stored page document references.
 *
 * The classes UI has to answer "how many places is this used" before an author
 * renames or deletes a class, and a class is referenced BY ID from inside each
 * page's stored document. Walking every document to answer that on demand is
 * the cost this exists to avoid: the answer is recorded when a page changes and
 * read back as a lookup.
 *
 * ## Why a page records what it USES, rather than a counter per class
 *
 * A counter maintained by increment and decrement is only correct if every
 * change is applied exactly once. Miss one and it is permanently low; apply one
 * twice and it is permanently high, and neither is visible from the number. A
 * page recording its own list is IDEMPOTENT instead — running it again writes
 * the same list, so a missed change costs nothing once the page is touched
 * again, and a repeated one costs nothing at all.
 *
 * That property is what makes the record repairable, and repairable is the
 * whole reason to prefer a stored answer over a live scan: the scan is still
 * there as the way to rebuild, so the stored answer is a cache of something
 * derivable rather than a second source of truth.
 *
 * ## What it can and cannot see
 *
 * Only `node.classes` inside a stored page document. A class named from custom
 * CSS, or from an author-supplied attribute, is invisible here — and any count
 * built on this has to say so where it is shown rather than implying it counted
 * everything.
 *
 * Within that, it reads exactly what the COMPILER reads: the first
 * `MAX_CLASSES_PER_NODE` entries of each node's list, over at most `MAX_NODES`
 * nodes. Those numbers are imported rather than restated, because a reader that
 * stopped anywhere else would select different nodes from the ones the compiler
 * writes rules for — omitting a class the stylesheet applies, which is the
 * absence a safe-delete check cannot afford.
 *
 * The bounds are on WORK, and a bound that ends the walk says so. An id missing
 * from a result whose `complete` is true means the document does not reference
 * it; when `complete` is false the list is a prefix, and an absence proves
 * nothing. That flag is what lets a caller treat a complete result as
 * authoritative for its own question: a bound that silently truncated the
 * result would make every absence ambiguous, and absence is what a safe-delete
 * check reads.
 *
 * ## Authored reference, not rendered reference
 *
 * The question this answers is which classes the document references AS
 * AUTHORED — not which classes a served page renders. The two differ, because
 * the renderer drops nodes before it draws: `pruneHiddenNodes` in
 * `@nextlyhq/blocks-react`'s visibility module removes every condition-gated
 * subtree, and further passes over the same `pruneNodes` walk drop blocks that
 * draw nothing and subtrees replaced by a placeholder. None of those run here,
 * and neither does the engine's `hiddenSubtreeNodes`, which names the same
 * gated subtrees. `selectNodes` deliberately leaves gating to its reader, and
 * the walk here does not ask. A class that appears only on a pruned node of
 * the walked document still counts, because the author put it there.
 *
 * One place gating IS asked, and only when `definitions` is passed: the
 * resolver leaves a condition-gated instance standing rather than inlining its
 * definition, so a class that exists only inside that definition is not in the
 * result. The record passes no `definitions` and is unaffected — a class inside
 * a definition belongs to that component's own record either way.
 *
 * That over-count is the direction to fail in. It warns about a delete that was
 * safe. Pruning would under-count instead, and an absent class may be deleted
 * while a live document still carries it on a gated node — rendered again as
 * soon as the gate stops withholding that node, with its rules gone. Only one
 * of those is recoverable.
 *
 * @module class-usage
 */
import {
  DEFAULT_LIMITS,
  MAX_CLASSES_PER_NODE,
  MAX_NAMED_CLASS_NAME_LENGTH,
  isPlainRecord,
  resolveComponentInstances,
  selectNodes,
} from "@nextlyhq/blocks-engine";
import type {
  BlockDocument,
  ComponentLookup,
  DocumentLimits,
} from "@nextlyhq/blocks-engine";

import { readStoredJson } from "./stored-json";

/**
 * Whether a stored value can name a class this site could actually define.
 *
 * Length is checked because `isUsableNamedClass` rejects an id past
 * `MAX_NAMED_CLASS_NAME_LENGTH` before it reads anything else, so a longer
 * string cannot match a usable class however it got here. Skipping it is both
 * the bound on what this reads and the correct answer: it references nothing.
 */
function namesAClass(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= MAX_NAMED_CLASS_NAME_LENGTH
  );
}

/**
 * Whether a stored value has the shape the walk reads: a record with a
 * `nodes` array.
 *
 * Spelled as a guard for the resolver's sake, which is typed by the document
 * it composes. Nothing past those two checks is validated — the resolver
 * begins with the same two and reads defensively from there, exactly as the
 * walk does, so a value that passes here is one both already accept.
 */
function composable(value: unknown): value is BlockDocument {
  return isPlainRecord(value) && Array.isArray(value.nodes);
}

/**
 * What a page's stored document says about the classes it references.
 *
 * Two values, because an empty list and an unreadable document are different
 * answers and a caller must be able to tell them apart. The whole point of the
 * record is to decide whether a class may be DELETED, and a delete check reads
 * absence as evidence — so an absence produced by a bound rather than by the
 * document has to be visible, or it is indistinguishable from "not used".
 */
export interface ClassUsage {
  /** The class ids the document references, sorted, without repeats. */
  ids: string[];
  /**
   * Whether the whole document was read.
   *
   * False when a bound ended the selection early, which means `ids` is a
   * PREFIX of the answer rather than the answer. A caller must not treat a
   * missing id as absent when this is false.
   */
  complete: boolean;
}

/**
 * The classes a stored document references, and whether it could all be read.
 *
 * Total by construction. This reads persisted data that nothing is guaranteed
 * to have validated — the blocks field deliberately admits any value whose
 * `nodes` is an array, so a malformed tree reaches storage intact — and a shape
 * this cannot read contributes nothing instead of raising.
 *
 * Sorted so two documents with the same references produce the same list, which
 * is what lets a caller compare a stored list against a fresh one without
 * re-sorting or set arithmetic.
 *
 * With `definitions`, the classes the document references through them: every
 * component instance is inlined the way the renderer inlines it, under the
 * same `limits`, before the walk. That is the editor's question — which
 * classes are on this page as composed — and it differs from the record's. The
 * record asks what THIS document references, and a class inside a component's
 * definition is that component's own record; without `definitions` an
 * instance stays the one stored node it is, which applies nothing.
 *
 * Neither form runs the renderer's visibility prune, so either may name a class
 * on a node the served page omits. The module docblock says why that over-count
 * is the safe direction. The composed form has one exception in the other
 * direction: a condition-gated instance is not inlined, so the classes only its
 * definition applies are absent even when `complete` is true.
 */
export function classUsageOf(
  stored: unknown,
  limits: DocumentLimits = DEFAULT_LIMITS,
  definitions?: ComponentLookup
): ClassUsage {
  const document = readStoredJson(stored);
  if (!composable(document)) return { ids: [], complete: true };

  // WHICH nodes are read is the engine's, shared with the style compiler rather
  // than reproduced here. The selection is the compiler's, so a reader that
  // stopped anywhere else would miss nodes the stylesheet has rules for. It is
  // not the served page's: no visibility prune runs, gated nodes included —
  // though the resolver leaves a gated instance standing, uninlined.
  //
  // Sharing the walk rather than the numbers is the part that matters. Both
  // sides once stopped at `MAX_NODES` by different routes — depth-first here,
  // level-order there — and equal limits reached by different walks select
  // different nodes: a document whose first root nests deeply spends the whole
  // budget inside it under one walk and reaches later top-level siblings under
  // the other. The class on that sibling was rendered and uncounted, which is
  // the under-count direction that lets a class in use be deleted.
  //
  // `limits` defaults to the engine's, which is what the compiler defaults to.
  // A site compiling with raised limits has to pass the same ones here, or the
  // two answer about different documents again — this parameter is how, and
  // there is no way for this function to discover them on its own.
  //
  // The resolver reads defensively too: a shape it cannot compose comes back
  // unchanged, and the walk below reads that.
  const rendered =
    definitions === undefined
      ? document
      : resolveComponentInstances(document, definitions, { limits }).document;
  const selection = selectNodes(rendered, limits);

  const ids = new Set<string>();
  for (const entry of selection.nodes) {
    const classes: unknown = (entry.node as { classes?: unknown }).classes;
    if (!Array.isArray(classes)) continue;
    // Bounds ENTRIES READ, not ids kept, and the two differ exactly where it
    // matters: an array of a million repeats holds one distinct id, so a
    // distinct-count bound never trips and the whole array is read. The cap is
    // the compiler's, which applies this many of a node's list and no more.
    const readable = Math.min(classes.length, MAX_CLASSES_PER_NODE);
    for (let i = 0; i < readable; i++) {
      const id: unknown = classes[i];
      if (namesAClass(id)) ids.add(id);
    }
  }

  return { ids: [...ids].sort(), complete: selection.stopped === undefined };
}
