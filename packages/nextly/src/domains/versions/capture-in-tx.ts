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
    maxPerDoc: args.maxPerDoc,
  });
}
