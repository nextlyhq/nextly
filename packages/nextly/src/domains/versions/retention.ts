/**
 * Retention selection for durable version rows.
 *
 * Pure and database-free so the protection rules can be tested in isolation.
 * The caller supplies durable rows only (autosave rows never count toward the
 * cap) ordered newest-first.
 *
 * @module domains/versions/retention
 */

import type { ChangedParts } from "./changed-parts";
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
   * The language the version holds, or null. Null means a document with no
   * languages, a snapshot of every language at once (a publish of all
   * languages, or of chosen parts), or the shared part. Retention keys on it
   * only for a version recorded before versions named their parts.
   */
  locale: string | null;
  /** A name given to the version; a named version is never removed. */
  label: string | null;
  /** The version a restore was made from, when this row records a restore. */
  sourceVersionNo: number | null;
  /**
   * The version each restored field came from, when the save this row records
   * carried restored values; absent or null when it carried none.
   */
  fieldSources?: Readonly<Record<string, number>> | null;
  /**
   * The languages, and whether the shared part, the version changed, as the
   * row records them (see `changed-parts`). Null or absent for a version
   * recorded before versions named their parts: such a version is kept by its
   * `locale` instead.
   */
  changedParts?: ChangedParts | null;
}

/**
 * Ids to delete so at most `maxPerDoc` durable versions remain, apart from the
 * versions that are always kept.
 *
 * Kept whatever the cap:
 * - the newest durable version (the document's current history head);
 * - the latest published version of EACH part: of each language, and of the
 *   shared part, judged by the parts each version records it changed. A
 *   publish of chosen parts, or of every language, records no language in
 *   `locale`, so keying this on `locale` (or on the document) lets a publish
 *   or a run of saves in one language remove another language's latest
 *   publish, and with it the only copy of what that language's readers see.
 *   A version recorded before versions named their parts keeps the rule it
 *   had: the latest published version of each `locale`, with no language its
 *   own key. The two kinds never stand in for each other, so retention keeps
 *   at least what it kept before parts were recorded. A version that changed
 *   no part (a restore's record of what it replaced) is no part's publish;
 *   the other rules here still keep it where they apply;
 * - every named version: someone (or a restore, for its undo point) chose to
 *   keep it;
 * - every row that records a restore, and the version it was made from, and
 *   each field's source a save's restored fields name, so "restored from"
 *   never points at a version that is gone. The save's own row is not pinned
 *   for naming sources: a client's save names them (`_restoredFrom`), and
 *   pinning every such row would let a caller keep each new version past the
 *   cap by naming the same source again;
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
  pinnedVersionNos?: readonly number[],
  /**
   * Whether the document has the Draft/Published lifecycle. Without it every
   * version was served, so each language's latest version is kept whatever
   * its status says. The capture service always states it.
   */
  lifecycle = true
): string[] {
  if (maxPerDoc === false) return [];
  if (rows.length <= maxPerDoc) return [];

  const protectedIds = protectedVersionIds(
    rows,
    [...(protectVersionNos ?? []), ...(pinnedVersionNos ?? [])],
    lifecycle
  );
  return rows
    .slice(Math.max(maxPerDoc, 0))
    .filter(r => !protectedIds.has(r.id))
    .map(r => r.id);
}

/** The ids of every row kept whatever the cap (see selectVersionsToPrune). */
function protectedVersionIds(
  rows: PrunableVersion[],
  protectVersionNos: readonly (number | null | undefined)[],
  lifecycle: boolean
): Set<string> {
  const protectedIds = new Set<string>(latestPublishedPerPart(rows, lifecycle));
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
    // Every version a saved field was restored from, so each "Restored from"
    // still points at a version that is there.
    ...rows.flatMap(r => Object.values(sourcesOf(r))),
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
 * The id of the latest published row for each part (see `partKeysOf`). Rows
 * arrive newest-first, so the first published row seen for a key is its
 * latest. "Published" is content readers were served, which without the
 * lifecycle is every version whatever its status.
 */
function latestPublishedPerPart(
  rows: PrunableVersion[],
  lifecycle: boolean
): string[] {
  const latest = new Map<string, string>();
  for (const row of rows) {
    if (!recordsServedContent(row.status, lifecycle)) continue;
    for (const key of partKeysOf(row)) {
      if (!latest.has(key)) latest.set(key, row.id);
    }
  }
  return [...latest.values()];
}

/**
 * The keys a published row can be the latest publish for. A row that records
 * its parts answers one per language it changed, and one for the shared part
 * when it changed it; none when it changed no part. A row recorded before
 * versions named their parts answers one: its `locale`, null included.
 *
 * Each key is a JSON array whose first item names its kind, so the kinds can
 * never collide: a row of one kind never takes a key of the other, and a
 * language code can never spell the shared part's key.
 */
function partKeysOf(row: PrunableVersion): string[] {
  const parts = row.changedParts;
  if (!parts) return [JSON.stringify(["locale", row.locale])];
  return [
    ...parts.locales.map(code => JSON.stringify(["language", code])),
    ...(parts.shared ? [JSON.stringify(["shared"])] : []),
  ];
}

/**
 * Whether a version carries a name. An empty label is no name (the admin
 * clears a name by storing null); the retention delete tests the same rule.
 */
function isNamed(row: PrunableVersion): boolean {
  return row.label !== null && row.label !== "";
}

/**
 * Whether a row records a restore, which names the version it came from: the
 * server writes that, never a client's save. A save's restored fields protect
 * the versions they name, not the row that names them.
 */
function isRestore(row: PrunableVersion): boolean {
  return typeof row.sourceVersionNo === "number";
}

/**
 * A row's field sources as a map, or an empty one. A read that handed the
 * JSON back as text would otherwise be walked character by character.
 */
function sourcesOf(row: PrunableVersion): Readonly<Record<string, number>> {
  const sources = row.fieldSources;
  return sources && typeof sources === "object" ? sources : {};
}
