/**
 * The shared in-transaction capture seam.
 *
 * A single point that assembles the just-written document and records one
 * durable version row, using the caller's transaction handle so the version
 * commits atomically with the content write. The write services call this once
 * per create/update after building their in-memory parts (parent row, component
 * subtrees, m2m id arrays), so the 3,500-line mutation service gains capture
 * without a second bespoke edit per path.
 *
 * History-only at this stage: the content status maps to a VersionStatus,
 * defaulting to "published" when absent or not a recognized status (the
 * draft/publish split is a later stage). The assembled snapshot is the same
 * shape the read path returns, so a restored version equals a normal read.
 *
 * @module domains/versions/capture-in-tx
 */

import { isVersionStatus } from "../../schemas/versions/types";

import {
  assembleDocument,
  type AssembleDocumentParts,
} from "./assemble-document";
import type { VersionsDbApi } from "./db-api";
import type {
  CaptureResult,
  VersionCaptureService,
} from "./version-capture-service";
import type { VersionRef } from "./versions-repository";

/** Arguments for a single in-transaction version capture. */
export interface CaptureInTxArgs {
  /** Which document this version belongs to (scope kind/slug + entry id). */
  ref: VersionRef;
  /**
   * The content document's own status value (e.g. `entry.status`). Normalized
   * to a VersionStatus; anything absent or unrecognized captures as "published".
   */
  contentStatus?: unknown;
  /** The in-memory pieces of the just-written document (assembled once here). */
  parts: AssembleDocumentParts;
  /** The acting user's id, or null for system/seed writes. */
  createdBy?: string | null;
  /** Retention cap for this document, from the resolved versions config. */
  maxPerDoc?: number | false;
  /**
   * The locale this snapshot holds.
   *
   * A localized document's snapshot records exactly one locale's values, not
   * all of them, so a version that does not say which locale it belongs to
   * cannot be restored without guessing which language to write into. Null for
   * an unlocalized document, where there is only one set of values.
   */
  locale?: string | null;
  /**
   * The version this write restored, when it was a restore.
   *
   * Lineage is recorded rather than inferred: a restore is an ordinary write
   * that happens to reproduce an earlier state, and nothing about the resulting
   * document distinguishes it from someone retyping the same content.
   */
  sourceVersionNo?: number | null;
}

/**
 * Assemble the document snapshot and capture one durable version inside `tx`.
 * Returns the allocated version number.
 */
export async function captureInTx(
  tx: VersionsDbApi,
  capture: VersionCaptureService,
  args: CaptureInTxArgs
): Promise<CaptureResult> {
  const status = isVersionStatus(args.contentStatus)
    ? args.contentStatus
    : "published";
  const snapshot = assembleDocument(args.parts);
  return capture.capture(tx, {
    ref: args.ref,
    status,
    snapshot,
    createdBy: args.createdBy ?? null,
    locale: args.locale ?? null,
    sourceVersionNo: args.sourceVersionNo ?? null,
    maxPerDoc: args.maxPerDoc,
  });
}
