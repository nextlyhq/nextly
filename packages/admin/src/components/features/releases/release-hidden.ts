/**
 * How a release talks about the documents in it that the reader may not read.
 *
 * The server never names them: it counts them by the collection or Single
 * they are in. These are the one set of sentences every release surface uses
 * for those counts, so the list, the release page, the stopped-release notice
 * and the schedule dialog say the same thing about the same documents.
 *
 * @module components/features/releases/release-hidden
 */

import type { HiddenReleaseMembers } from "@admin/types/releases";

/** How many documents these counts cover, together. */
export function hiddenTotal(
  hidden: readonly HiddenReleaseMembers[] | undefined
): number {
  return (hidden ?? []).reduce((total, entry) => total + entry.count, 0);
}

/** "document" or "documents", for a count. */
function documents(count: number): string {
  return count === 1 ? "document" : "documents";
}

/**
 * Where hidden documents are, as the admin names a collection elsewhere: its
 * plural for several documents, its singular for one, and its slug only when
 * it has no names.
 */
function scopeName(entry: HiddenReleaseMembers): string {
  if (!entry.labels) return entry.scopeSlug;
  return entry.count === 1 ? entry.labels.singular : entry.labels.plural;
}

/**
 * "1 document you can't view · Secret", "3 documents you can't view · Posts,
 * History notes". `null` when nothing is hidden, so a caller renders nothing.
 */
export function describeHidden(
  hidden: readonly HiddenReleaseMembers[] | undefined
): string | null {
  const total = hiddenTotal(hidden);
  if (total === 0) return null;
  const where = [...new Set((hidden ?? []).map(scopeName))];
  return `${total} ${documents(total)} you can't view · ${where.join(", ")}`;
}

/**
 * "1 document you can't view needs a fix", "2 documents you can't view need a
 * fix": why a release is not ready, or would stop, when the reason is in a
 * document the reader cannot open.
 */
export function describeHiddenNeedFix(count: number): string {
  return `${count} ${documents(count)} you can't view ${count === 1 ? "needs" : "need"} a fix`;
}
