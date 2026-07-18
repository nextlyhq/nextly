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

/**
 * Per-collection / per-single versioning options (the code-first + Schema
 * Builder config surface). Three orthogonal concerns are nested so invalid
 * combinations are unrepresentable: history is always on when versioning is
 * enabled; drafts add a draft/publish lifecycle; autosave coalesces the
 * in-progress draft. See the design spec section 3.
 */
export interface VersionsConfig {
  /**
   * Add a draft / published lifecycle. `false` = history-only (every write is
   * a restorable version, no draft state). An object configures autosave and
   * the reserved timed-publish flag.
   */
  drafts?:
    | boolean
    | {
        /** Coalesced autosave of the in-progress draft. Default 1000ms when on. */
        autosave?: boolean | { intervalMs?: number };
        /** Reserve the `scheduled` status for future timed publish. */
        schedulePublish?: boolean;
      };
  /** Durable (non-autosave) versions kept per document. `false` = unlimited. Default 50. */
  maxPerDoc?: number | false;
}

/**
 * The canonical, fully-defaulted shape every versioning consumer reads (the
 * mutation service, admin, plugin surface). `resolveVersionsConfig` produces
 * it; `null` means the entity is unversioned.
 */
export interface ResolvedVersionsConfig {
  /** Always true on a resolved config (null represents "disabled"). */
  enabled: true;
  drafts: {
    /** Draft/publish lifecycle on. `false` = history-only. */
    enabled: boolean;
    autosave: {
      enabled: boolean;
      intervalMs: number;
    };
    schedulePublish: boolean;
  };
  /** Durable versions retained per document; `false` = unlimited. */
  maxPerDoc: number | false;
}
