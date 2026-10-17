/**
 * Retention for the record of content events.
 *
 * A subject's events (a document's or a release's) are kept while the subject
 * exists, whatever the activity log's window. Its deletion is itself an event,
 * stored as one that ends its subject; once that event is older than the
 * activity log's window, the subject's events up to and including it are
 * removed with their parts, oldest first, in bounded batches. A subject
 * recreated under the same id keeps the events of its new life, which come
 * after the deletion.
 *
 * @module domains/content-events/prune
 */

import {
  CONTENT_EVENTS_TABLE,
  CONTENT_EVENT_PARTS_TABLE,
} from "../../schemas/content-events";
import type { Logger } from "../../shared/types";
import type { NoticesPruneDb } from "../notices/notices-service";
import { warnQuietly } from "../retention/safe-log";
import type { VersionsWhereCondition } from "../versions/db-api";

/** Rows touched per statement: small enough to keep each delete short. */
const CONTENT_EVENT_PRUNE_BATCH = 500;

/**
 * What the prune needs of the database: a plain read and a delete, in the
 * shape every activity-window pruner takes, so the write paths' adapter and
 * the scheduled drain's both satisfy it.
 */
export type ContentEventsPruneDb = NoticesPruneDb;

interface EndedSubject {
  /** The deletion event: the last event of the life it ended. */
  id: string;
  subjectKind: string;
  subjectSlug: string | null;
  subjectId: string;
}

function subjectWhere(subject: EndedSubject): VersionsWhereCondition[] {
  return [
    { column: "subjectKind", op: "=", value: subject.subjectKind },
    subject.subjectSlug === null
      ? { column: "subjectSlug", op: "IS NULL" }
      : { column: "subjectSlug", op: "=", value: subject.subjectSlug },
    { column: "subjectId", op: "=", value: subject.subjectId },
  ];
}

/** The oldest deletion event past `before`, if any. */
async function oldestEndedSubject(
  db: ContentEventsPruneDb,
  before: Date
): Promise<EndedSubject | undefined> {
  const [ended] = await db.select<EndedSubject>(CONTENT_EVENTS_TABLE, {
    columns: ["id", "subjectKind", "subjectSlug", "subjectId"],
    where: {
      and: [
        { column: "endsSubject", op: "=", value: true },
        { column: "occurredAt", op: "<", value: before },
      ],
    },
    orderBy: [{ column: "occurredAt", direction: "asc" }],
    limit: 1,
  });
  return ended;
}

/**
 * Remove one batch of the ended life's events and their parts, oldest first,
 * so the deletion event goes in the last batch and a subject left part-done is
 * found again by the next pass. Returns how many events were removed.
 */
async function deleteEndedBatch(
  db: ContentEventsPruneDb,
  ended: EndedSubject
): Promise<number> {
  const rows = await db.select<{ id: string }>(CONTENT_EVENTS_TABLE, {
    columns: ["id"],
    where: {
      and: [
        ...subjectWhere(ended),
        // Ids are time-ordered: the ended life, not one that came after.
        { column: "id", op: "<=", value: ended.id },
      ],
    },
    orderBy: [{ column: "id", direction: "asc" }],
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

/**
 * Remove the events of subjects deleted more than `maxAgeMs` ago, at most
 * `maxBatches` batches, stopping between batches at `deadline`.
 *
 * Never throws: a retention pass is offered by ordinary writes, and a failure
 * here must not reach the write that offered it.
 *
 * @returns how many events were removed, and whether a batch was started: a
 *   pass that started none did no work, and its caller should give its turn
 *   back.
 */
export async function pruneContentEventsSafely(
  deps: {
    db: ContentEventsPruneDb;
    now?: () => Date;
    logger?: Logger;
    deadline?: Date;
  },
  maxAgeMs: number,
  maxBatches: number
): Promise<{ removed: number; started: boolean }> {
  const now = deps.now ?? (() => new Date());
  const before = new Date(now().getTime() - maxAgeMs);
  let removed = 0;
  let started = false;
  try {
    // A database from before the record has nothing to prune.
    if (
      deps.db.tableExists &&
      !(await deps.db.tableExists(CONTENT_EVENTS_TABLE))
    ) {
      return { removed, started: true };
    }
    for (let batch = 0; batch < maxBatches; batch += 1) {
      if (deps.deadline !== undefined && now() >= deps.deadline) break;
      started = true;
      const ended = await oldestEndedSubject(deps.db, before);
      if (!ended) break;
      removed += await deleteEndedBatch(deps.db, ended);
    }
  } catch (error) {
    // A failure is a pass that ran: retrying at once would fail the same way.
    started = true;
    warnQuietly(deps.logger, "Content events retention pass failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
  return { removed, started };
}
