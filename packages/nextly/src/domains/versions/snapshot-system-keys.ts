/**
 * The framework-managed keys at the top of a version snapshot.
 *
 * They describe the document's record (its id, timestamps, author and
 * lifecycle state), never what an editor wrote. A comparison of two versions
 * and the question "did this save change anything" both leave them out, so they
 * are named once here rather than listed by each.
 *
 * @module domains/versions/snapshot-system-keys
 */

/** Keys on a top-level document that are never user content. */
export const DOCUMENT_SYSTEM_KEYS: ReadonlySet<string> = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "createdBy",
  "status",
]);
