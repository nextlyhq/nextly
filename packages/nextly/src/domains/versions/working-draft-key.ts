/**
 * The value stored in `nextly_versions.draft_key`.
 *
 * A working draft is the one row class the table's sequence index cannot
 * constrain: it carries no `version_no`, and SQL treats NULL as distinct from
 * NULL, so a unique index over `(scope_kind, scope_slug, entry_id, version_no)`
 * lets any number of them coexist. This column carries a value ONLY on a
 * working draft, so a plain unique index over it alone constrains that class
 * and leaves durable and autosave rows untouched — the same NULL tolerance
 * `nextly_versions_seq_uidx` already relies on.
 *
 * A digest rather than the readable composite: the four inputs are bounded, but
 * percent-encoding can triple a segment and MySQL's index key limit is 3072
 * bytes, which utf8mb4 spends at 768 characters. Capping the length would let a
 * truncation merge two documents into one key, which is precisely the failure
 * the constraint exists to prevent. The row keeps all four source columns, so
 * the value can always be recomputed.
 *
 * Segments are percent-encoded before joining so a delimiter occurring inside a
 * slug or an id cannot forge a collision.
 *
 * @module domains/versions/working-draft-key
 */
import { createHash } from "node:crypto";

import type { VersionRef } from "./versions-repository";

/**
 * The uniqueness key for the working draft of one document in one language.
 *
 * `null` locale is the unlocalized document, and encodes to the empty segment —
 * unambiguous because encoding leaves every configured locale non-empty.
 */
export function workingDraftKey(
  ref: VersionRef,
  locale: string | null
): string {
  const joined = [ref.scopeKind, ref.scopeSlug, ref.entryId, locale ?? ""]
    .map(encodeURIComponent)
    .join(":");
  return createHash("sha256").update(joined, "utf8").digest("hex");
}
