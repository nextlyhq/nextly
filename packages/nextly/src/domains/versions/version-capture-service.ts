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
   * using `db` (the transaction context) so the version commits atomically with
   * the caller's content write. The next number is `max + 1`; the PG partial
   * unique index (and serialized writes on MySQL/SQLite) is the race backstop.
   */
  async capture(
    db: VersionsDbApi,
    input: CaptureInput
  ): Promise<CaptureResult> {
    const repo = new VersionsRepository(db);
    const versionNo = (await repo.getMaxVersionNo(input.ref)) + 1;
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
    return { versionNo };
  }
}
