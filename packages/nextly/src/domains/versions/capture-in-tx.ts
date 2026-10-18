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
import { sameContent } from "./draft-save";
import type { VersionCaptureService } from "./version-capture-service";
import { VersionsRepository, type VersionRef } from "./versions-repository";

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
  /**
   * A human-readable marker for this version, when one is meaningful — e.g. the
   * pre-restore snapshot a restore takes of the content it is about to replace,
   * so history reads it as that state rather than an ordinary save.
   */
  label?: string | null;
  /**
   * Record nothing when the save leaves this part of the document as its
   * newest version holds it. For an UPDATE only: a create always records the
   * version that says the document began, even where an earlier document
   * under the same id left versions behind.
   */
  onlyIfChanged?: boolean;
}

/**
 * Whether this save leaves its part of the document as its newest version
 * already holds it: the same status, and the same content by the comparison a
 * held save uses (`sameContent`, framework keys such as timestamps aside).
 * Such a save records no version, so history is not filled with entries that
 * changed nothing and the retention cap is not spent on them.
 *
 * Both sides are assembled snapshots: the newest version was captured through
 * this same assembly. A restore, and a named version, always record: the
 * first names what it came from, and the second is asked for by name.
 */
async function changesNothing(
  tx: VersionsDbApi,
  args: CaptureInTxArgs,
  status: string,
  snapshot: Record<string, unknown>
): Promise<boolean> {
  if (alwaysRecords(args)) return false;
  const latest = await new VersionsRepository(tx).findLatestInPart(
    args.ref,
    args.locale ?? null
  );
  if (!latest || latest.status !== status) return false;
  const entity = args.ref.scopeKind === "single" ? "single" : "collection";
  return holdsTheSame(latest.snapshot, snapshot, entity);
}

/** A save that records whatever it holds: a create, a restore, a named version. */
function alwaysRecords(args: CaptureInTxArgs): boolean {
  return (
    !args.onlyIfChanged ||
    typeof args.sourceVersionNo === "number" ||
    Boolean(args.label)
  );
}

/** Whether a stored version's snapshot holds what this save would record. */
function holdsTheSame(
  previous: unknown,
  snapshot: Record<string, unknown>,
  entity: "single" | "collection"
): boolean {
  if (previous === null || typeof previous !== "object") return false;
  const before = previous as Record<string, unknown>;
  // The stored `status` itself, beside the version status it normalizes to.
  // Under the draft/published lifecycle the two say the same thing; without
  // it `status` is an authored field, and two values that both normalize to
  // "published" are still a change.
  if (
    JSON.stringify(snapshot.status ?? null) !==
    JSON.stringify(before.status ?? null)
  ) {
    return false;
  }
  return sameContent(snapshot, before, entity);
}

/**
 * Assemble the document snapshot and capture one durable version inside `tx`.
 * Returns the allocated version number, or null when the save changed nothing
 * and so recorded no version.
 */
export async function captureInTx(
  tx: VersionsDbApi,
  capture: VersionCaptureService,
  args: CaptureInTxArgs
): Promise<{ versionNo: number | null }> {
  const status = isVersionStatus(args.contentStatus)
    ? args.contentStatus
    : "published";
  const snapshot = assembleDocument(args.parts);
  if (await changesNothing(tx, args, status, snapshot)) {
    return { versionNo: null };
  }
  return capture.capture(tx, {
    ref: args.ref,
    status,
    snapshot,
    createdBy: args.createdBy ?? null,
    locale: args.locale ?? null,
    sourceVersionNo: args.sourceVersionNo ?? null,
    label: args.label ?? null,
    maxPerDoc: args.maxPerDoc,
  });
}
