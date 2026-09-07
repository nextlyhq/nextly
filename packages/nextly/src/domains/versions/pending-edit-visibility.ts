/**
 * Which pending-edit rows this caller may actually be told about.
 *
 * 🔴 The version table is keyed by (scopeKind, scopeSlug, entryId) and carries
 * no access rules of its own, so a read of it bounded only by collection name
 * answers about documents the ordinary read path would refuse. Entity-level
 * access decides whether a collection is IN REACH; a stored `owner-only` or
 * `custom` read rule then narrows which of its rows come back, and that second
 * axis is invisible to a slug filter. Without this pass the dashboard's cards
 * counted one author's documents for another and listed their entry ids and the
 * instants they were edited.
 *
 * The decision itself belongs to {@link visibleDocuments}, which the activity
 * feed asks the same question of. This module is the TRANSLATION from a version
 * row to the document it names, and nothing more — so the two surfaces cannot
 * come to different conclusions about who may see a document.
 *
 * That split is not tidiness. Both surfaces once carried their own copy, and
 * the copies did not stay equal: per-locale grouping, the registry-kind check,
 * the stale-locale drop, bounded concurrency and resolving a Single's live id
 * before probing it were each present on one side and absent from the other,
 * every one of them a defect on the side that lacked it.
 *
 * Version rows OUTLIVE the things they describe — that is what history is — so a
 * row reaching here may name a document, a language or an entity that no longer
 * exists, or a slug some other entity has since taken over. Each of those is
 * UNDECIDABLE rather than deniable, and `visibleDocuments` drops every one:
 * nothing can judge them, and admitting what cannot be judged is the inversion
 * this pass exists to remove.
 *
 * @module domains/versions/pending-edit-visibility
 */

import type { ReadCaller } from "../../services/dashboard/readable-resources";
import {
  resolveDocumentVisibilityScope,
  visibleDocuments,
  type DocumentVisibilityScope,
} from "../../services/lib/document-visibility";

import type { VersionMeta } from "./versions-repository";

/**
 * The install-wide facts one query's pages are all judged against.
 *
 * Re-exported under this domain's own name rather than making callers reach
 * into the shared module: the versions source resolves it once per query and
 * threads it down, and the name says what it scopes.
 */
export type PendingEditScope = DocumentVisibilityScope;

/** One resolution of the registry and the configured languages. */
export const resolvePendingEditScope = resolveDocumentVisibilityScope;

/** `rows`, in their original order, keeping only what the caller may be told. */
export async function visiblePendingEdits(
  rows: readonly VersionMeta[],
  caller: ReadCaller,
  scope: PendingEditScope
): Promise<VersionMeta[]> {
  return visibleDocuments(
    rows,
    // The whole translation: a version row already records the kind, the slug,
    // the document and the language it was drafted in. Whether those still name
    // anything readable is `visibleDocuments`'s question, not this one's.
    //
    // 🔴 `VersionScopeKind` is wider than the two kinds a content read path can
    // answer for -- it also admits `page`, which the page builder captures
    // versions under. Such a row resolves to `null` and is DROPPED, because
    // there is no collection or single read path to ask about it; coercing it
    // to either would send it to a service that does not hold the document.
    row =>
      row.scopeKind === "collection" || row.scopeKind === "single"
        ? {
            kind: row.scopeKind,
            slug: row.scopeSlug,
            entryId: row.entryId,
            locale: row.locale,
          }
        : null,
    caller,
    scope
  );
}
