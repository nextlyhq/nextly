/**
 * What one language of a translated document shows of the fields every language shares.
 *
 * A save written in place in one language writes the shared fields for all of them, while each
 * language's own recorded version keeps the shared values it was saved with. So what a language
 * shows now is its own newest version with the shared values written since laid over it. Both the
 * check that withdraws an approval on a save and the step that gives one read a part through
 * these two functions, so an approval is judged, and its digest kept, from the content the next
 * save is compared with.
 *
 * @module domains/workflows/shared-values
 */
import { snapshotRecord } from "../versions/shared-publish-base";
import { documentSystemKeys } from "../versions/snapshot-system-keys";

import type { ReviewDocument } from "./review-state-repository";

/** The framework's keys of a document's snapshot, which no language owns or shares. */
function systemKeysOf(document: ReviewDocument): ReadonlySet<string> {
  return documentSystemKeys(
    document.scopeKind === "single" ? "single" : "collection"
  );
}

/**
 * The shared values `snapshot` holds: every field but the translated ones (`translated`) and the
 * keys the framework manages.
 */
export function sharedValuesOf(
  document: ReviewDocument,
  snapshot: unknown,
  translated: readonly string[]
): Record<string, unknown> {
  const left = new Set([...translated, ...systemKeysOf(document)]);
  return Object.fromEntries(
    Object.entries(snapshotRecord(snapshot)).filter(([key]) => !left.has(key))
  );
}

/** `snapshot` with the shared values of `sharedFrom` laid over it. */
export function withSharedValuesOf(
  document: ReviewDocument,
  snapshot: unknown,
  sharedFrom: unknown,
  translated: readonly string[]
): Record<string, unknown> {
  return {
    ...snapshotRecord(snapshot),
    ...sharedValuesOf(document, sharedFrom, translated),
  };
}
