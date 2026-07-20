/**
 * Retention selection for durable version rows.
 *
 * Pure and database-free so the protection rules can be tested in isolation.
 * The caller supplies durable rows only (autosave rows never count toward the
 * cap) ordered newest-first.
 *
 * @module domains/versions/retention
 */

import type { VersionStatus } from "../../schemas/versions/types";

/** The minimum shape retention needs from a durable version row. */
export interface PrunableVersion {
  id: string;
  versionNo: number | null;
  status: VersionStatus;
}

/**
 * Ids to delete so at most `maxPerDoc` durable versions remain.
 *
 * Two rows are never returned regardless of the cap: the newest durable version
 * (the document's current history head) and the most recent version whose
 * status is "published" (what a reader is currently being served). Protecting
 * the latter means a long draft streak cannot silently evict the live content's
 * snapshot.
 *
 * @param rows Durable rows for one document, newest-first.
 * @param maxPerDoc Cap, or `false` for unlimited.
 */
export function selectVersionsToPrune(
  rows: PrunableVersion[],
  maxPerDoc: number | false
): string[] {
  if (maxPerDoc === false) return [];
  if (rows.length <= maxPerDoc) return [];

  const protectedIds = new Set<string>();
  // Newest durable version: the history head is always kept, even at cap 0.
  if (rows[0]) protectedIds.add(rows[0].id);
  // Most recent published version: the snapshot matching what readers see.
  const latestPublished = rows.find(r => r.status === "published");
  if (latestPublished) protectedIds.add(latestPublished.id);

  return rows
    .slice(Math.max(maxPerDoc, 0))
    .filter(r => !protectedIds.has(r.id))
    .map(r => r.id);
}
