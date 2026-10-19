/**
 * The status a version records, told truthfully.
 *
 * Under the draft/published lifecycle a document's status is "draft" or
 * "published". Without it, `status` is an ordinary field the developer
 * declared, and it holds whatever they chose ("archived", "in review"). A
 * version records that value as it is: calling an archived document
 * "published" would make history, retention and the "currently published"
 * comparison all treat as live something that never was.
 *
 * A document with no status at all records "published": with no lifecycle,
 * what is saved is what is live.
 *
 * The column holds 32 characters. A select or radio `status` field is refused
 * at definition when an option is longer, so only a free-text value can
 * exceed it. That value records its first 31 characters and "…", so nothing
 * reads it as the whole value, and the whole value stays verbatim in the
 * version's snapshot. The overflow is reported once per process for each
 * collection or Single, so a site that keeps long statuses is not flooded.
 *
 * @module domains/versions/recorded-status
 */

import type { VersionStatus } from "../../schemas/versions/types";

import type { VersionRef } from "./versions-repository";

/**
 * A version's status: one the lifecycle names, or a document's own status
 * value where there is no lifecycle.
 */
export type RecordedVersionStatus = VersionStatus | (string & {});

/** The width of the versions table's `status` column (MySQL's `varchar`). */
export const STATUS_COLUMN_LENGTH = 32;

/** Collections and Singles already reported as holding a status too long. */
const reported = new Set<string>();

/** Tell someone a status was shortened, once for each document type. */
export type OverflowReport = (detail: {
  scopeKind: VersionRef["scopeKind"];
  scopeSlug: string;
  length: number;
}) => void;

/** The status a version records for a document holding `value`. */
export function recordedStatus(
  value: unknown,
  ref: VersionRef,
  report: OverflowReport
): RecordedVersionStatus {
  if (value === undefined || value === null || value === "") return "published";
  // A status that is not text (a number, say) records as it would read: an
  // object as its JSON, anything else in its ordinary written form.
  const text =
    typeof value === "string"
      ? value
      : typeof value === "object"
        ? JSON.stringify(value)
        : `${value as number | boolean | bigint}`;
  if (text.length <= STATUS_COLUMN_LENGTH) return text;
  const key = `${ref.scopeKind}:${ref.scopeSlug}`;
  if (!reported.has(key)) {
    reported.add(key);
    report({
      scopeKind: ref.scopeKind,
      scopeSlug: ref.scopeSlug,
      length: text.length,
    });
  }
  return `${text.slice(0, STATUS_COLUMN_LENGTH - 1)}…`;
}
