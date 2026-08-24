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
  MAX_CLASSES_PER_NODE,
  MAX_NAMED_CLASS_NAME_LENGTH,
  MAX_NODES,
  isPlainRecord,
  walkNodes,
} from "@nextlyhq/blocks-engine";
import type { BlockNode } from "@nextlyhq/blocks-engine";

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
 * The class ids a document references, sorted, without repeats.
 *
 * Total by construction. This reads persisted data that nothing is guaranteed
 * to have validated — `documentFrom` deliberately admits any value whose
 * `nodes` is an array, so a malformed tree reaches storage intact — and it runs
 * inside a write hook, where throwing would fail the author's save over a
 * bookkeeping record. Every level is therefore guarded rather than trusted, and
 * a shape this cannot read contributes nothing instead of raising.
 *
 * Sorted so two documents with the same references produce the same list, which
 * is what lets a caller compare a stored list against a fresh one without
 * re-sorting or set arithmetic.
 */
export function classIdsUsedBy(stored: unknown): string[] {
  const document = readStoredJson(stored);
  if (!isPlainRecord(document)) return [];
  const nodes: unknown = document.nodes;
  if (!Array.isArray(nodes)) return [];

  const ids = new Set<string>();
  let nodesRead = 0;
  walkNodes(nodes as BlockNode[], node => {
    // Both bounds below are the COMPILER's, taken from the engine rather than
    // chosen here, because the question is which classes this page renders. A
    // reader that stopped somewhere else would answer about a different
    // document than the one being served — reporting a reference the page does
    // not apply, or omitting one it does.
    //
    // A cap on DISTINCT ids used to sit here instead, and it was the wrong
    // quantity twice over. It let a corrupt array of repeats be scanned in full
    // while never filling, since repeats add no distinct entry; and once it did
    // fill, it dropped every later id — so a page mentioning many ids of
    // deleted classes before a live one omitted the live one, which is the
    // direction that gets a class deleted while a page still uses it. The two
    // caps below bound the work by construction and drop nothing reachable.
    if (nodesRead >= MAX_NODES) return;
    nodesRead++;

    const classes: unknown = (node as { classes?: unknown }).classes;
    if (!Array.isArray(classes)) return;
    // Bounds ENTRIES READ, not ids kept, and the two differ exactly where it
    // matters: an array of a million repeats holds one distinct id, so a
    // distinct-count bound never trips and the whole array is read.
    const readable = Math.min(classes.length, MAX_CLASSES_PER_NODE);
    for (let i = 0; i < readable; i++) {
      const id: unknown = classes[i];
      if (namesAClass(id)) ids.add(id);
    }
  });
  return [...ids].sort();
}
