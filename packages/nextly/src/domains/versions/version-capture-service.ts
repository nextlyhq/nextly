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
import type { VersionStatus } from "../../schemas/versions/types";
import {
  CORE_CONTENT_EVENT_KINDS,
  ensureCoreContentEventKinds,
} from "../content-events/core-kinds";
import { recordContentEvent } from "../content-events/record";

import type { VersionsDbApi } from "./db-api";
import { selectVersionsToPrune } from "./retention";
import { VersionConflictError, isUniqueViolation } from "./version-conflict";
import { pinnedVersionNos } from "./version-pins";
import { VersionsRepository, type VersionRef } from "./versions-repository";

/** Input to capture a durable version. */
export interface CaptureInput {
  ref: VersionRef;
  status: VersionStatus;
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
   * That race is caught by the durable-sequence unique index and surfaced as a
   * VersionConflictError for the write path to retry.
   */
  async capture(
    db: VersionsDbApi,
    input: CaptureInput
  ): Promise<CaptureResult> {
    const repo = new VersionsRepository(db);
    const versionNo = (await repo.getMaxVersionNo(input.ref)) + 1;
    try {
      await repo.insertVersion({
        ref: input.ref,
        versionNo,
        status: input.status,
        isAutosave: false,
        snapshot: input.snapshot,
        label: input.label ?? null,
        locale: input.locale ?? null,
        sourceVersionNo: input.sourceVersionNo ?? null,
        createdBy: input.createdBy ?? null,
      });
    } catch (err) {
      // The only unique index on nextly_versions is the version_no sequence, so
      // a unique violation here is a lost allocation race (concurrent capture on
      // the same document read the same max). The tx-context insert throws the
      // RAW driver error (not yet normalized to a DbError), so isUniqueViolation
      // recognizes raw driver codes / the adapter DatabaseError too. Surface it
      // as a distinct error so the write path retries the whole transaction;
      // anything else propagates.
      if (isUniqueViolation(err)) {
        throw new VersionConflictError(err);
      }
      throw err;
    }
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
 */
async function recordRetentionRemoval(
  db: VersionsDbApi,
  ref: VersionRef,
  count: number
): Promise<void> {
  if (count <= 0) return;
  if (ref.scopeKind !== "collection" && ref.scopeKind !== "single") return;
  ensureCoreContentEventKinds();
  await recordContentEvent(db, {
    subject: { kind: ref.scopeKind, slug: ref.scopeSlug, id: ref.entryId },
    kind: CORE_CONTENT_EVENT_KINDS.versionsRemoved.name,
    actor: { kind: "system" },
    payload: { count },
  });
}
