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
 * @module class-usage
 */
import {
  MAX_NAMED_CLASSES,
  MAX_NAMED_CLASS_NAME_LENGTH,
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
  walkNodes(nodes as BlockNode[], node => {
    const classes: unknown = (node as { classes?: unknown }).classes;
    if (!Array.isArray(classes)) return;
    for (const id of classes) {
      // Bounded by the size of the library it is counted against: a page cannot
      // usefully reference more DISTINCT classes than a site can define, so a
      // document claiming to is corrupt and reading further buys nothing.
      //
      // Tested per ID rather than per node, which is where the bound has to sit
      // to be one: a single node carrying an oversized `classes` array is the
      // cheapest way to produce this shape, and a check that only ran between
      // nodes would let that one array through whole.
      if (ids.size >= MAX_NAMED_CLASSES) return;
      if (namesAClass(id)) ids.add(id);
    }
  });
  return [...ids].sort();
}
