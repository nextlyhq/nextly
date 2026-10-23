/**
 * One person's repeated saves of one document, as one row of the feed.
 *
 * The trail keeps every save as its own row, and stays that way: this only
 * decides what the feed SHOWS. Read newest first, a save joins the run before
 * it when it is the same person's update of the same document, made within
 * {@link RUN_GAP_MS} of the next later save in that run. So a run is a chain,
 * and may span longer than the gap.
 *
 * It runs over the rows the reader may see, after each has been authorized,
 * and over nothing else. A row the reader may not see is, for them, not
 * between two saves; breaking a run on it would split one visible row into
 * two and so tell them that something happened there.
 *
 * @module services/dashboard/activity-runs
 */

import { SETTINGS_ACTIVITY_NAMESPACES } from "../../domains/audit/settings-activity-namespaces";

import { changedFieldsOf, changesStatus } from "./activity-changes";

/** The longest gap between two saves of one run: ten minutes. */
export const RUN_GAP_MS = 10 * 60 * 1000;

/** What the feed shows for one row: one row of the trail, or a run of saves. */
export interface ActivityRun {
  /** The newest row: what the feed shows, and the time it shows. */
  latest: Record<string, unknown>;
  /** The oldest row: where the feed continues after this one. */
  oldest: Record<string, unknown>;
  /** How many rows of the trail this one stands for. */
  count: number;
}

/** Whether `slug` is a namespace install-level settings changes are filed under. */
export function isSettingsNamespace(slug: string): boolean {
  return (SETTINGS_ACTIVITY_NAMESPACES as readonly string[]).includes(slug);
}

/**
 * Whether a row is an install-level settings change rather than a document's:
 * it says so, or it predates the kind being recorded and is filed under a
 * settings namespace.
 */
function isSettingsChange(row: Record<string, unknown>): boolean {
  if (row.subjectKind === "settings") return true;
  return (
    (row.subjectKind ?? null) === null &&
    typeof row.collection === "string" &&
    isSettingsNamespace(row.collection)
  );
}

/** `value` as milliseconds since the epoch, or undefined when it is not an instant. */
function instantOf(value: unknown): number | undefined {
  const at =
    value instanceof Date
      ? value.getTime()
      : typeof value === "string"
        ? new Date(value).getTime()
        : Number.NaN;
  return Number.isNaN(at) ? undefined : at;
}

/**
 * Who saved which document, for a row that may join a run; `undefined` for
 * one that never does.
 *
 * Only an update of an entry or a Single joins. A create or a delete is an
 * event in its own right; an install-level settings change names no entry or
 * Single, and each stays its own row even when it carries an id. An update
 * that changed the status is a publish or an unpublish, which stays visible as
 * its own row even when it also carried edits. So does an entry's update that
 * records no changed fields, written before they were recorded or by a save
 * that changed nothing: it cannot show it was not a publish, and a run would
 * hide one if it was. A Single's save records none yet, so a Single's saves
 * still join, a publish of one among them. The actor is the kind and the
 * reference together, as a row written before the kind was recorded is a
 * person's.
 */
export function runKeyOf(row: Record<string, unknown>): string | undefined {
  if (row.action !== "update") return undefined;
  if (typeof row.entryId !== "string" || row.entryId.length === 0) {
    return undefined;
  }
  if (isSettingsChange(row)) return undefined;
  if (changesStatus(row.metadata)) return undefined;
  if (
    row.subjectKind !== "single" &&
    changedFieldsOf(row.metadata) === undefined
  ) {
    return undefined;
  }
  return JSON.stringify([
    row.actorType ?? "user",
    row.userId,
    row.subjectKind ?? null,
    row.collection,
    row.entryId,
  ]);
}

/** Whether `next`, the row after `run` in newest-first order, continues it. */
function continues(run: ActivityRun, next: Record<string, unknown>): boolean {
  const key = runKeyOf(run.oldest);
  if (key === undefined || runKeyOf(next) !== key) return false;
  const later = instantOf(run.oldest.createdAt);
  const earlier = instantOf(next.createdAt);
  return (
    later !== undefined &&
    earlier !== undefined &&
    later - earlier <= RUN_GAP_MS
  );
}

/** `rows`, newest first as the feed reads them, as the rows the feed shows. */
export function runsOf(
  rows: readonly Record<string, unknown>[]
): ActivityRun[] {
  const runs: ActivityRun[] = [];
  for (const row of rows) {
    const current = runs[runs.length - 1];
    if (current && continues(current, row)) {
      current.oldest = row;
      current.count += 1;
    } else {
      runs.push({ latest: row, oldest: row, count: 1 });
    }
  }
  return runs;
}

/** A run a previous page was cut inside: its key, and its oldest save read so far. */
export interface CutRun {
  key: string;
  createdAt: Date | string;
}

/**
 * `rows`, newest first, without the leading rows that continue `cut`: the rest
 * of a run the previous page already showed, as a floor, and must not show
 * again as a row of its own. Stops at the first row of another run, or one
 * past the gap. Also the last row it left out, where a page that left out
 * every row it read continues from.
 */
export function afterRun(
  rows: readonly Record<string, unknown>[],
  cut: CutRun | undefined
): {
  rest: readonly Record<string, unknown>[];
  skipped?: Record<string, unknown>;
} {
  if (!cut) return { rest: rows };
  let later = instantOf(cut.createdAt);
  let index = 0;
  for (; index < rows.length; index++) {
    const row = rows[index];
    const at = instantOf(row?.createdAt);
    if (
      !row ||
      runKeyOf(row) !== cut.key ||
      later === undefined ||
      at === undefined ||
      later - at > RUN_GAP_MS
    ) {
      break;
    }
    later = at;
  }
  return index === 0
    ? { rest: rows }
    : { rest: rows.slice(index), skipped: rows[index - 1] };
}
