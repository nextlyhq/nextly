/**
 * Captures one durable version row using the caller's database handle.
 *
 * The collection and Single write services call it, directly or through
 * captureInTx, with their transaction context, so the version commits with the
 * content write.
 * It allocates the next version_no, inserts the row, and then applies
 * retention in the same transaction.
 *
 * @module domains/versions/version-capture-service
 */

import { NextlyError } from "../../errors";
import { markWriteIntegrityFailure } from "../../shared/write-integrity";
import {
  CORE_CONTENT_EVENT_KINDS,
  ensureCoreContentEventKinds,
} from "../content-events/core-kinds";
import { recordContentEvent } from "../content-events/record";

import type { VersionsDbApi } from "./db-api";
import type { RecordedVersionStatus } from "./recorded-status";
import { selectVersionsToPrune } from "./retention";
import { VersionConflictError, isUniqueViolation } from "./version-conflict";
import { pinnedVersionNos } from "./version-pins";
import { VersionsRepository, type VersionRef } from "./versions-repository";

/** Input to capture a durable version. */
export interface CaptureInput {
  ref: VersionRef;
  /** The document's status as a version records it (see `recorded-status`). */
  status: RecordedVersionStatus;
  snapshot: unknown;
  createdBy?: string | null;
  label?: string | null;
  locale?: string | null;
  sourceVersionNo?: number | null;
  /**
   * Durable versions retained for this document; `false` or omitted leaves
   * history unbounded. Applied in the caller's transaction right after the
   * insert, so the cap holds without a background worker.
   */
  maxPerDoc?: number | false;
}

/** The allocated number of a captured version. */
export interface CaptureResult {
  versionNo: number;
}

export class VersionCaptureService {
  /**
   * Allocate the next durable version_no for the document and insert one row,
   * using `db` (the transaction context) so the insert commits atomically with
   * the caller's content write. The next number is `max + 1`.
   *
   * Reads through the transaction context DO run on the transaction's own
   * connection on every dialect: each adapter's tx `select` forwards the
   * transaction handle as the executor, so the allocation read and the
   * retention scan below both observe this transaction's uncommitted writes.
   *
   * A duplicate version_no is still possible when two transactions allocate
   * concurrently, because each reads a max the other has not yet committed.
   * The durable-sequence unique index catches it, and the insert alone is
   * retried with the latest number (see `insertWithRetry`), so a batch is not
   * aborted, nor its hooks run twice, for a number another write took.
   */
  async capture(
    db: VersionsDbApi,
    input: CaptureInput
  ): Promise<CaptureResult> {
    const repo = new VersionsRepository(db);
    const versionNo = await insertWithRetry(db, repo, input);
    // Trim history to the configured cap inside the caller's transaction. What
    // is always kept (the newest version, each language's latest published one,
    // named versions and restore lineage) is decided by selectVersionsToPrune.
    if (typeof input.maxPerDoc === "number") {
      const durable = await repo.listDurableForPrune(input.ref);
      // A restore's own capture additionally protects two versions. The one
      // holding the content it just replaced — the one the editor is told they
      // can go back to — is `versionNo - 1`: this insert took the next number,
      // so the previous one was the head when the restore began. And the
      // version restored FROM, which this row names as its source: pruning it
      // in the same transaction would leave that lineage pointing at nothing.
      const isRestore = typeof input.sourceVersionNo === "number";
      // A restore reads its source before this transaction began, so a save
      // committed in between can have pruned it. Recording it as the source
      // then would leave lineage pointing at a version that is gone, so the
      // restore is refused instead, and nothing it wrote is kept.
      if (
        isRestore &&
        !durable.some(row => row.versionNo === input.sourceVersionNo)
      ) {
        throw NextlyError.conflict({
          reason: "state",
          message:
            "The version you restored from was removed from the history while restoring. Reload the history and choose a version that is still kept.",
          logContext: {
            reason: "restore-source-pruned",
            scopeKind: input.ref.scopeKind,
            scopeSlug: input.ref.scopeSlug,
            entryId: input.ref.entryId,
            sourceVersionNo: input.sourceVersionNo,
          },
        });
      }
      // Read on this transaction, after the save's document lock: a pin takes
      // the same lock, so it either is read here or waits for this pass.
      const pinned = await pinnedVersionNos(db, input.ref);
      const staleIds = selectVersionsToPrune(
        durable,
        input.maxPerDoc,
        [isRestore ? versionNo - 1 : null, input.sourceVersionNo],
        pinned
      );
      if (staleIds.length > 0) {
        const removed = await repo.deletePrunedVersions(staleIds);
        await recordRetentionRemoval(db, input.ref, removed);
      }
    }
    return { versionNo };
  }
}

/**
 * One event in the document's history for a retention pass that removed
 * versions, on the capture's own transaction, so history shows where older
 * versions went. The retention policy removed them, so the system is named
 * as who did it. Collections and Singles keep a record of content events; a
 * page's history keeps none yet.
 *
 * A failure is marked write-integrity: the pass has already removed versions,
 * and a batch that softened it to one failed item would commit the removal
 * with no record of it.
 */
async function recordRetentionRemoval(
  db: VersionsDbApi,
  ref: VersionRef,
  count: number
): Promise<void> {
  if (count <= 0) return;
  if (ref.scopeKind !== "collection" && ref.scopeKind !== "single") return;
  ensureCoreContentEventKinds();
  try {
    await recordContentEvent(db, {
      subject: { kind: ref.scopeKind, slug: ref.scopeSlug, id: ref.entryId },
      kind: CORE_CONTENT_EVENT_KINDS.versionsRemoved.name,
      actor: { kind: "system" },
      payload: { count },
    });
  } catch (error) {
    throw markWriteIntegrityFailure(error);
  }
}

/** How many numbers one capture tries before giving the race up. */
const INSERT_ATTEMPTS = 3;

let savepointSequence = 0;

/**
 * Insert the version under the next free number, retrying the insert alone
 * when a concurrent transaction took that number first.
 *
 * Only the insert repeats: the write around it, and its hooks, ran once and
 * stay as they are. On PostgreSQL a failed statement aborts the transaction,
 * so each attempt runs in a savepoint and a clash rolls back to it; SQLite
 * has savepoints too. MySQL has none here and needs none: a duplicate key
 * fails the statement, not the transaction. Each retry re-reads the newest
 * number with a locking read, which sees the row the other transaction
 * committed (a plain read on MySQL would answer from a stale snapshot).
 *
 * Three lost races in a row surface as a VersionConflictError, which an
 * interactive write retries whole.
 */
async function insertWithRetry(
  db: VersionsDbApi,
  repo: VersionsRepository,
  input: CaptureInput
): Promise<number> {
  for (let attempt = 1; ; attempt += 1) {
    const versionNo =
      (await repo.getMaxVersionNo(input.ref, { latest: attempt > 1 })) + 1;
    try {
      await underSavepoint(db, () =>
        repo.insertVersion({
          ref: input.ref,
          versionNo,
          status: input.status,
          isAutosave: false,
          snapshot: input.snapshot,
          label: input.label ?? null,
          locale: input.locale ?? null,
          sourceVersionNo: input.sourceVersionNo ?? null,
          createdBy: input.createdBy ?? null,
        })
      );
      return versionNo;
    } catch (err) {
      // The only unique index on nextly_versions is the version_no sequence,
      // so a unique violation is a lost allocation race. The insert throws the
      // RAW driver error, which isUniqueViolation recognizes; anything else
      // propagates as it is.
      if (!isUniqueViolation(err)) throw err;
      if (attempt >= INSERT_ATTEMPTS) throw new VersionConflictError(err);
    }
  }
}

/**
 * Run `work` inside a savepoint where the transaction has them, so a failure
 * rolls back only `work` and the transaction carries on; without them, run it
 * plainly.
 */
async function underSavepoint<T>(
  db: VersionsDbApi,
  work: () => Promise<T>
): Promise<T> {
  if (!db.savepoint || !db.rollbackToSavepoint || !db.releaseSavepoint) {
    return work();
  }
  savepointSequence += 1;
  const name = `nextly_version_insert_${savepointSequence}`;
  await db.savepoint(name);
  try {
    const result = await work();
    await db.releaseSavepoint(name);
    return result;
  } catch (err) {
    await db.rollbackToSavepoint(name);
    await db.releaseSavepoint(name);
    throw err;
  }
}
