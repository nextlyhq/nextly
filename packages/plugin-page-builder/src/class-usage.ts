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
 * nodes. Those numbers are imported rather than restated, because the question
 * is which classes the page renders — a reader that stopped anywhere else would
 * answer about a document other than the one being served, naming a class the
 * page never applies or omitting one it does.
 *
 * The bounds are on WORK, never on the answer. Nothing reachable is dropped, so
 * an id missing from the result means the document does not render it. That is
 * what lets a caller treat this as authoritative for its own question; a bound
 * that silently truncated the result would make every absence ambiguous, and
 * absence is what a safe-delete check reads.
 *
 * @module class-usage
 */
import {
  DEFAULT_LIMITS,
  MAX_CLASSES_PER_NODE,
  MAX_NAMED_CLASS_NAME_LENGTH,
  isPlainRecord,
  selectNodes,
} from "@nextlyhq/blocks-engine";
import type { DocumentLimits } from "@nextlyhq/blocks-engine";

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
 */
export function classUsageOf(
  stored: unknown,
  limits: DocumentLimits = DEFAULT_LIMITS
): ClassUsage {
  const document = readStoredJson(stored);
  if (!isPlainRecord(document)) return { ids: [], complete: true };
  if (!Array.isArray(document.nodes)) return { ids: [], complete: true };

  // WHICH nodes are read is the engine's, shared with the style compiler rather
  // than reproduced here. The question is which classes this page RENDERS, so a
  // reader that stopped anywhere else would answer about a different document
  // than the one being served.
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
  const selection = selectNodes(document, limits);

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
