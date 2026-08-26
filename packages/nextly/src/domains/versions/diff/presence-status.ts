/**
 * What the PRESENCE of two sides implies about a field's status.
 *
 * Content and presence are separate questions, and presence is answerable in
 * cases where content is not: a field whose value cannot be read at all still
 * either was or was not there. Keeping the presence answer means an
 * absent-to-unreadable field reports `added` rather than collapsing to the
 * vaguer `changed`, which is strictly more information and still true.
 *
 * Shared by the rich-text and source comparisons because they ask exactly this
 * question. Two copies would agree on the day they were written and drift after.
 *
 * @module domains/versions/diff/presence-status
 */

import type { DiffStatus } from "./types";

/**
 * `added` or `removed` when exactly one side was absent; otherwise `fallback` —
 * the answer the caller derived from comparing content, since presence alone
 * separates nothing when both sides agree on it.
 */
export function presenceStatus(
  beforeAbsent: boolean,
  afterAbsent: boolean,
  fallback: DiffStatus
): DiffStatus {
  if (beforeAbsent && !afterAbsent) return "added";
  if (afterAbsent && !beforeAbsent) return "removed";
  return fallback;
}
