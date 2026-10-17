/**
 * Retention for the record of content events.
 *
 * A subject's events (a document's or a release's) are kept while the subject
 * exists, whatever the activity log's window. Its deletion is itself an event,
 * of a kind that ends its subject; once that event is older than the activity
 * log's window, every event of the subject is removed with its parts, in
 * bounded batches.
 *
 * @module domains/content-events/prune
 */

import {
  CONTENT_EVENTS_TABLE,
  CONTENT_EVENT_PARTS_TABLE,
} from "../../schemas/content-events";
import type { Logger } from "../../shared/types";
import { warnQuietly } from "../retention/safe-log";
import type { VersionsDbApi, VersionsWhereCondition } from "../versions/db-api";

import { subjectEndingKinds } from "./kinds";

/** Rows touched per statement: small enough to keep each delete short. */
const CONTENT_EVENT_PRUNE_BATCH = 500;

export interface ContentEventsPruneDb extends VersionsDbApi {
  tableExists?(table: string): Promise<boolean>;
}

interface SubjectRow {
  subjectKind: string;
  subjectSlug: string | null;
  subjectId: string;
}

function subjectWhere(subject: SubjectRow): VersionsWhereCondition[] {
  return [
    { column: "subjectKind", op: "=", value: subject.subjectKind },
    subject.subjectSlug === null
      ? { column: "subjectSlug", op: "IS NULL" }
      : { column: "subjectSlug", op: "=", value: subject.subjectSlug },
    { column: "subjectId", op: "=", value: subject.subjectId },
  ];
}

/**
 * Remove one batch of a subject's events and their parts. Returns how many
 * events were removed; fewer than a batch means the subject is done.
 */
async function deleteSubjectBatch(
  db: ContentEventsPruneDb,
  subject: SubjectRow
): Promise<number> {
  const rows = await db.select<{ id: string }>(CONTENT_EVENTS_TABLE, {
    columns: ["id"],
    where: { and: subjectWhere(subject) },
    limit: CONTENT_EVENT_PRUNE_BATCH,
  });
  if (rows.length === 0) return 0;
  const ids = rows.map(row => row.id);
  // Parts first, so no part row is left naming an event that is gone.
  await db.delete(CONTENT_EVENT_PARTS_TABLE, {
    and: [{ column: "eventId", op: "IN", value: ids }],
  });
  await db.delete(CONTENT_EVENTS_TABLE, {
    and: [{ column: "id", op: "IN", value: ids }],
  });
  return ids.length;
}

/** The subject whose deletion is the oldest one past `before`, if any. */
async function oldestEndedSubject(
  db: ContentEventsPruneDb,
  endings: string[],
  before: Date
): Promise<SubjectRow | undefined> {
  const [ended] = await db.select<SubjectRow>(CONTENT_EVENTS_TABLE, {
    columns: ["subjectKind", "subjectSlug", "subjectId"],
    where: {
      and: [
        { column: "kind", op: "IN", value: endings },
        { column: "occurredAt", op: "<", value: before },
      ],
    },
    orderBy: [{ column: "occurredAt", direction: "asc" }],
    limit: 1,
  });
  return ended;
}

/**
 * A subject's events, its deletion event among them, batch by batch, within
 * `budget` batches. A subject left part-done is finished by the next pass.
 */
async function deleteSubject(
  db: ContentEventsPruneDb,
  subject: SubjectRow,
  budget: number
): Promise<{ removed: number; batches: number }> {
  let removed = 0;
  let batches = 0;
  while (batches < budget) {
    batches += 1;
    const count = await deleteSubjectBatch(db, subject);
    removed += count;
    if (count < CONTENT_EVENT_PRUNE_BATCH) break;
  }
  return { removed, batches };
}

/**
 * Remove the events of subjects deleted more than `maxAgeMs` ago, at most
 * `maxBatches` batches.
 *
 * Never throws: a retention pass is offered by ordinary writes, and a failure
 * here must not reach the write that offered it.
 */
export async function pruneContentEventsSafely(
  deps: { db: ContentEventsPruneDb; now?: () => Date; logger?: Logger },
  maxAgeMs: number,
  maxBatches: number
): Promise<{ removed: number }> {
  const now = deps.now ?? (() => new Date());
  const before = new Date(now().getTime() - maxAgeMs);
  const endings = subjectEndingKinds();
  let removed = 0;
  try {
    if (endings.length === 0) return { removed };
    // A database from before the record has nothing to prune.
    if (
      deps.db.tableExists &&
      !(await deps.db.tableExists(CONTENT_EVENTS_TABLE))
    ) {
      return { removed };
    }
    let batches = 0;
    while (batches < maxBatches) {
      const ended = await oldestEndedSubject(deps.db, endings, before);
      if (!ended) break;
      const done = await deleteSubject(deps.db, ended, maxBatches - batches);
      batches += done.batches;
      removed += done.removed;
    }
  } catch (error) {
    warnQuietly(deps.logger, "Content events retention pass failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
  return { removed };
}
