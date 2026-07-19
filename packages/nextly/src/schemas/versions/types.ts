/**
 * Dialect-agnostic types for the `nextly_versions` table.
 *
 * `nextly_versions` is the single global content-version store: one JSONB
 * snapshot per captured document state, across all collections/singles/pages.
 * The per-dialect Drizzle tables (postgres/mysql/sqlite.ts) share these types.
 *
 * @module schemas/versions/types
 */

/**
 * Lifecycle state stamped on a version row. A restore is identified by a
 * non-null `sourceVersionNo`, not a distinct status, so the active set stays
 * small; `scheduled` is reserved for the future timed-publish executor.
 */
export type VersionStatus = "draft" | "published" | "unpublished" | "scheduled";

/** The kind of document a version belongs to (Nextly's `{ kind, slug }` scope). */
export type VersionScopeKind = "collection" | "single" | "page";

/** The active status set, in canonical order. */
export const VERSION_STATUSES: readonly VersionStatus[] = [
  "draft",
  "published",
  "unpublished",
  "scheduled",
];

/** Runtime guard: true iff `v` is one of the active version statuses. */
export function isVersionStatus(v: unknown): v is VersionStatus {
  return (
    typeof v === "string" && (VERSION_STATUSES as readonly string[]).includes(v)
  );
}
