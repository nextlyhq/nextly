/**
 * The value stored in `nextly_release_members.member_key`.
 *
 * One document appears at most once per release per language, and that is the
 * one rule a plain composite unique index cannot express here: `locale` is
 * nullable, and SQL treats NULL as distinct from NULL, so a unique index over
 * `(release_id, scope_kind, scope_slug, entry_id, locale)` would admit any
 * number of UNLOCALIZED members for the same document. This column always
 * carries a value, so a unique index over it alone constrains every member,
 * localized or not.
 *
 * A digest rather than the readable composite, for the reason
 * `workingDraftKey` gives: the segments are bounded but percent-encoding can
 * triple one, and MySQL's index key limit is 3072 bytes, which utf8mb4 spends
 * at 768 characters. Capping the length would let a truncation merge two
 * members into one key — precisely the failure the constraint exists to
 * prevent. The row keeps all five source columns, so the value can always be
 * recomputed.
 *
 * Segments are percent-encoded before joining so a delimiter occurring inside a
 * slug or an id cannot forge a collision.
 *
 * @module domains/releases/release-member-key
 */
import { createHash } from "node:crypto";

import type { VersionScopeKind } from "../../schemas/versions/types";

/** The document a member points at. */
export interface MemberDocumentRef {
  scopeKind: VersionScopeKind;
  scopeSlug: string;
  entryId: string;
  /** `null` is the unlocalized document, matching `nextly_versions.locale`. */
  locale: string | null;
}

/**
 * The uniqueness key for one document, in one language, in one release.
 *
 * A `null` locale encodes to the empty segment — unambiguous because encoding
 * leaves every configured locale non-empty.
 */
export function releaseMemberKey(
  releaseId: string,
  ref: MemberDocumentRef
): string {
  const joined = [
    releaseId,
    ref.scopeKind,
    ref.scopeSlug,
    ref.entryId,
    ref.locale ?? "",
  ]
    .map(encodeURIComponent)
    .join(":");
  return createHash("sha256").update(joined, "utf8").digest("hex");
}
