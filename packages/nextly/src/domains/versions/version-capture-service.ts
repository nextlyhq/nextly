/**
 * Captures one durable version row using the caller's database handle.
 *
 * Stage 1 provides durable capture only (allocate version_no + insert). It is
 * intentionally NOT wired into any mutation path yet; Stage 2 calls it from the
 * collection/single write services with the transaction context, after building
 * the snapshot with assembleDocument(). Autosave coalescing and inline pruning
 * arrive in Stage 4.
 *
 * @module domains/versions/version-capture-service
 */

import type { VersionStatus } from "../../schemas/versions/types";

import type { VersionsDbApi } from "./db-api";
import { selectVersionsToPrune } from "./retention";
import { VersionConflictError, isUniqueViolation } from "./version-conflict";
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
    // Trim history to the configured cap inside the caller's transaction. The
    // newest version and the most recent published one are always protected, so
    // the head of history and the snapshot matching live content survive.
    if (typeof input.maxPerDoc === "number") {
      const durable = await repo.listDurableForPrune(input.ref);
      // A restore's own capture additionally protects two versions. The one
      // holding the content it just replaced — the one the editor is told they
      // can go back to — is `versionNo - 1`: this insert took the next number,
      // so the previous one was the head when the restore began. And the
      // version restored FROM, which this row names as its source: pruning it
      // in the same transaction would leave that lineage pointing at nothing.
      const isRestore = typeof input.sourceVersionNo === "number";
      const staleIds = selectVersionsToPrune(durable, input.maxPerDoc, [
        isRestore ? versionNo - 1 : null,
        input.sourceVersionNo,
      ]);
      if (staleIds.length > 0) {
        await repo.deleteByIds(staleIds);
      }
    }
    return { versionNo };
  }
}
