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
}

/** The allocated number of a captured version. */
export interface CaptureResult {
  versionNo: number;
}

export class VersionCaptureService {
  /**
   * Allocate the next durable version_no for the document and insert one row,
   * using `db` (the transaction context) so the insert commits atomically with
   * the caller's content write. The next number is `max + 1`; this allocation
   * read does not itself run inside the transaction (the tx context's `select`
   * delegates to the adapter's main connection pool, not the transaction's own
   * connection, on Postgres/MySQL), so a duplicate version_no is possible under
   * concurrent capture. The PG partial unique index guards against it there; a
   * MySQL/SQLite serialization or unique guard is required in a later stage
   * before capture is wired into concurrent writes.
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
      // the same document read the same max). Surface it as a distinct error so
      // the write path retries the whole transaction; anything else propagates.
      if (
        isUniqueViolation(err) ||
        isUniqueViolation((err as { cause?: unknown }).cause)
      ) {
        throw new VersionConflictError(err);
      }
      throw err;
    }
    return { versionNo };
  }
}
