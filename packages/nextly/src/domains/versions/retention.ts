/**
 * Retention selection for durable version rows.
 *
 * Pure and database-free so the protection rules can be tested in isolation.
 * The caller supplies durable rows only (autosave rows never count toward the
 * cap) ordered newest-first.
 *
 * @module domains/versions/retention
 */

import {
  recordsServedContent,
  type RecordedVersionStatus,
} from "./recorded-status";

/** The minimum shape retention needs from a durable version row. */
export interface PrunableVersion {
  id: string;
  versionNo: number | null;
  status: RecordedVersionStatus;
  /**
   * The language the version holds, or null. On today's rows null means a
   * document with no languages, a snapshot of every language at once (a
   * publish of all languages), or the shared part; each is its own key below.
   */
  locale: string | null;
  /** A name given to the version; a named version is never removed. */
  label: string | null;
  /** The version a restore was made from, when this row records a restore. */
  sourceVersionNo: number | null;
}

/**
 * Ids to delete so at most `maxPerDoc` durable versions remain, apart from the
 * versions that are always kept.
 *
 * Kept whatever the cap:
 * - the newest durable version (the document's current history head);
 * - the latest published version of EACH language, and the latest published
 *   version with no language. Keying this on the document instead lets a run
 *   of saves in one language remove another language's only published
 *   snapshot, and with it the only copy of what that language's readers see;
 * - every named version: someone (or a restore, for its undo point) chose to
 *   keep it;
 * - every row that records a restore, and the version it was made from, so
 *   "restored from" never points at a version that is gone;
 * - every version a feature has pinned (`pinnedVersionNos`): a feature holds
 *   it for as long as it needs it, whatever the limit;
 * - the version numbers the caller names for this pass.
 *
 * The newest `maxPerDoc` rows stay; of the older rows, only the protected ones
 * stay.
 *
 * @param rows Durable rows for one document, newest-first.
 * @param maxPerDoc Cap, or `false` for unlimited.
 */
export function selectVersionsToPrune(
  rows: PrunableVersion[],
  maxPerDoc: number | false,
  /**
   * Version numbers that must survive this pass regardless of the cap.
   *
   * A restore records the content it replaced as a version and then tells the
   * editor the change can be undone. At a small cap the very next retention
   * pass would remove exactly that version, so the undo would be gone the
   * moment it was promised. The version a restore was made FROM is protected
   * on the same grounds: the new row records it as its source, and pruning it
   * in the same transaction leaves that lineage pointing at nothing.
   */
  protectVersionNos?: readonly (number | null | undefined)[],
  /** Version numbers a feature has pinned; see `version-pins`. */
  pinnedVersionNos?: readonly number[]
): string[] {
  if (maxPerDoc === false) return [];
  if (rows.length <= maxPerDoc) return [];

  const protectedIds = protectedVersionIds(rows, [
    ...(protectVersionNos ?? []),
    ...(pinnedVersionNos ?? []),
  ]);
  return rows
    .slice(Math.max(maxPerDoc, 0))
    .filter(r => !protectedIds.has(r.id))
    .map(r => r.id);
}

/** The ids of every row kept whatever the cap (see selectVersionsToPrune). */
function protectedVersionIds(
  rows: PrunableVersion[],
  protectVersionNos: readonly (number | null | undefined)[]
): Set<string> {
  const protectedIds = new Set<string>(latestPublishedPerLocale(rows));
  // Newest durable version: the history head is always kept, even at cap 0.
  if (rows[0]) protectedIds.add(rows[0].id);

  // One lookup by number, built once: a backlog can hold hundreds of rows, and
  // every restore source and caller-named version is looked up in it.
  const idByVersionNo = new Map<number | null, string>(
    rows.map(r => [r.versionNo, r.id])
  );
  const keepVersionNos = [
    ...protectVersionNos,
    ...rows.map(r => r.sourceVersionNo),
  ];
  for (const versionNo of keepVersionNos) {
    const id = typeof versionNo === "number" && idByVersionNo.get(versionNo);
    if (id) protectedIds.add(id);
  }

  for (const row of rows) {
    if (isNamed(row) || isRestore(row)) protectedIds.add(row.id);
  }
  return protectedIds;
}

/**
 * The id of the latest published row of each language, null (no language)
 * keyed like any code. Rows arrive newest-first, so the first published row
 * seen for a language is its latest. "Published" is content readers were
 * served, which without the lifecycle is every version whatever its status.
 */
function latestPublishedPerLocale(rows: PrunableVersion[]): string[] {
  const latest = new Map<string | null, string>();
  for (const row of rows) {
    if (recordsServedContent(row.status) && !latest.has(row.locale)) {
      latest.set(row.locale, row.id);
    }
  }
  return [...latest.values()];
}

/**
 * Whether a version carries a name. An empty label is no name (the admin
 * clears a name by storing null); the retention delete tests the same rule.
 */
function isNamed(row: PrunableVersion): boolean {
  return row.label !== null && row.label !== "";
}

/** Whether a row records a restore, which names the version it came from. */
function isRestore(row: PrunableVersion): boolean {
  return typeof row.sourceVersionNo === "number";
}
