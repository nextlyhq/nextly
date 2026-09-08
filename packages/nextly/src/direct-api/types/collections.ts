/**
 * Direct API Collection Type Definitions
 *
 * Argument and result types for collection CRUD, counting, and bulk operations.
 *
 * @packageDocumentation
 */

import type { HookWarning } from "../../hooks/side-effect-warnings";

import type {
  CollectionSlug,
  DirectAPIConfig,
  PopulateOptions,
  WhereFilter,
} from "./shared";

/**
 * Arguments for finding multiple documents in a collection.
 *
 * @typeParam TSlug - The collection slug literal type (auto-inferred from `collection`)
 *
 * @example
 * ```typescript
 * // With generated types - slug and return type are inferred:
 * const posts = await nextly.find({ collection: 'posts' });
 * // posts.items is typed as Post[]
 *
 * // Without generated types - accepts any string:
 * const posts = await nextly.find({
 *   collection: 'posts',
 *   where: { status: { equals: 'published' } },
 *   limit: 10,
 *   sort: '-createdAt',
 *   depth: 2,
 * });
 * ```
 */
export interface FindArgs<TSlug extends CollectionSlug = CollectionSlug>
  extends DirectAPIConfig {
  /** Collection slug (required) */
  collection: TSlug;

  /**
   * Query conditions for filtering.
   *
   * Where clause syntax for filtering.
   *
   * @example
   * ```typescript
   * where: {
   *   status: { equals: 'published' },
   *   publishedAt: { less_than: new Date().toISOString() },
   * }
   * ```
   */
  where?: WhereFilter;

  /**
   * This `where` was built by the framework from a route it was asked to
   * render, rather than received from a request.
   *
   * Exempts it from the guard that refuses a filter naming a field the caller
   * may not read. That guard's subject is a caller CHOOSING probe values to
   * bisect a hidden value; framework lookups do not choose, they address.
   *
   * Declared HERE, on the per-operation arguments, and deliberately not on
   * `DirectAPIConfig`: `mergeConfig` fills anything a nested Direct API call
   * omits from the instance defaults, so a config-level exemption would let a
   * caller-supplied `where` reaching a nested read acquire the framework's
   * trust. Absent means untrusted, and nothing can supply it on a caller's
   * behalf.
   */
  frameworkFilter?: true;

  /**
   * Draft/Published lifecycle scope for the read (only effective when the
   * collection has the built-in `status` lifecycle). Unlike a `where` clause on
   * the `status` column, this drives the query service's lifecycle-aware filter,
   * so it ALSO constrains a localized collection's per-locale companion
   * `_status` — a draft translation under a published main row is not returned.
   * `"published"` is enforced even for a trusted (`overrideAccess: true`) read.
   */
  status?: "published" | "draft" | "all";

  /**
   * Maximum documents per page.
   *
   * @default 10
   */
  limit?: number;

  /**
   * Page number (1-indexed).
   *
   * @default 1
   */
  page?: number;

  /**
   * Sort order.
   *
   * Use field name for ascending, prefix with `-` for descending.
   *
   * @example
   * ```typescript
   * sort: '-createdAt'  // Newest first
   * sort: 'title'       // Alphabetical
   * ```
   */
  sort?: string;

  /**
   * Specific fields to include/exclude.
   *
   * Set field to `true` to include, `false` to exclude.
   * By default, all non-hidden fields are included.
   *
   * @example
   * ```typescript
   * select: { title: true, content: true, author: true }
   * ```
   */
  select?: Record<string, boolean>;

  /**
   * Control relationship population per field.
   *
   * @example
   * ```typescript
   * populate: {
   *   author: { select: { name: true, email: true } },
   *   category: false,  // Don't populate
   * }
   * ```
   */
  populate?: Record<string, boolean | PopulateOptions>;

  /**
   * Disable pagination and return all documents.
   *
   * When `false`, returns all matching documents without pagination metadata.
   * Use with caution for large collections.
   *
   * @default true
   */
  pagination?: boolean;
}

/**
 * Arguments for finding a single document by ID.
 *
 * @example
 * ```typescript
 * const post = await nextly.findByID({
 *   collection: 'posts',
 *   id: 'post-123',
 *   depth: 2,
 * });
 * ```
 */
export interface FindByIDArgs<TSlug extends CollectionSlug = CollectionSlug>
  extends DirectAPIConfig {
  /** Collection slug (required) */
  collection: TSlug;

  /** Document ID (required) */
  id: string;

  /**
   * Return the pending working draft in place of the live row when one exists
   * (draft/published split). Mirrors the read-side `draft` parameter in
   * Payload's `findByID`. Effective only on a drafts-enabled, non-localized
   * collection with the `status` lifecycle, and gated by an update-capability
   * probe: a caller who cannot edit the document still gets the published row,
   * so this never exposes a draft to a read-only caller.
   *
   * @default false
   */
  draft?: boolean;

  /**
   * Specific fields to include/exclude.
   */
  select?: Record<string, boolean>;

  /**
   * Control relationship population per field.
   */
  populate?: Record<string, boolean | PopulateOptions>;
}

/**
 * Arguments for creating a new document.
 *
 * @typeParam TSlug - The collection slug literal type (auto-inferred from `collection`)
 *
 * @example
 * ```typescript
 * const post = await nextly.create({
 *   collection: 'posts',
 *   data: {
 *     title: 'Hello World',
 *     content: 'My first post',
 *     status: 'draft',
 *   },
 * });
 * ```
 */
export interface CreateArgs<TSlug extends CollectionSlug = CollectionSlug>
  extends DirectAPIConfig {
  /** Collection slug (required) */
  collection: TSlug;

  /** Document data (required) */
  data: Record<string, unknown>;

  /**
   * ID of existing document to duplicate.
   *
   * When provided, copies data from the source document
   * and merges with provided `data`.
   */
  duplicateFromID?: string;

  /**
   * Skip validation hooks.
   *
   * @default false
   */
  draft?: boolean;

  /**
   * Disable verification email for auth collections.
   *
   * When creating users in auth-enabled collections,
   * set to `true` to skip sending verification email.
   *
   * @default false
   */
  disableVerificationEmail?: boolean;

  /**
   * Skip cache revalidation for this write (the outbox drain still runs, so
   * webhooks are unaffected). Set by a CLI, seed, or bulk-import caller that
   * owns its own cache strategy and does not want a revalidation per row.
   *
   * @default false
   */
  disableRevalidate?: boolean;
}

/**
 * Arguments for updating an existing document.
 *
 * Supports updating by ID or by where clause (bulk update).
 *
 * @typeParam TSlug - The collection slug literal type (auto-inferred from `collection`)
 *
 * @example
 * ```typescript
 * // Update by ID
 * await nextly.update({
 *   collection: 'posts',
 *   id: 'post-123',
 *   data: { status: 'published' },
 * });
 *
 * // Bulk update by where clause
 * await nextly.update({
 *   collection: 'posts',
 *   where: { status: { equals: 'draft' } },
 *   data: { status: 'archived' },
 * });
 * ```
 */
export interface UpdateArgs<TSlug extends CollectionSlug = CollectionSlug>
  extends DirectAPIConfig {
  /** Collection slug (required) */
  collection: TSlug;

  /**
   * Document ID for single update.
   *
   * Either `id` or `where` must be provided.
   */
  id?: string;

  /**
   * Query conditions for bulk update.
   *
   * Either `id` or `where` must be provided.
   */
  where?: WhereFilter;

  /** Update data (required) */
  data: Record<string, unknown>;

  /**
   * Autosave draft instead of publishing.
   *
   * @default false
   */
  draft?: boolean;

  /**
   * Overwrite existing files instead of creating new versions.
   *
   * Applies to upload collections.
   *
   * @default false
   */
  overwriteExistingFiles?: boolean;

  /**
   * Skip cache revalidation for this write (the outbox drain still runs). Set by
   * a CLI, seed, or bulk-import caller that owns its own cache strategy.
   *
   * @default false
   */
  disableRevalidate?: boolean;
}

/**
 * Arguments for deleting documents.
 *
 * Supports deleting by ID or by where clause (bulk delete).
 *
 * @example
 * ```typescript
 * // Delete by ID
 * await nextly.delete({
 *   collection: 'posts',
 *   id: 'post-123',
 * });
 *
 * // Bulk delete by where clause
 * await nextly.delete({
 *   collection: 'posts',
 *   where: { status: { equals: 'archived' } },
 * });
 * ```
 */
export interface DeleteArgs<TSlug extends CollectionSlug = CollectionSlug>
  extends DirectAPIConfig {
  /** Collection slug (required) */
  collection: TSlug;

  /**
   * Document ID for single delete.
   *
   * Either `id` or `where` must be provided.
   */
  id?: string;

  /**
   * Query conditions for bulk delete.
   *
   * Either `id` or `where` must be provided.
   */
  where?: WhereFilter;

  /**
   * Skip cache revalidation for this delete (the outbox drain still runs). Set
   * by a CLI, seed, or bulk-import caller that owns its own cache strategy.
   *
   * @default false
   */
  disableRevalidate?: boolean;
}

/**
 * Arguments for counting documents in a collection.
 *
 * @example
 * ```typescript
 * const { total } = await nextly.count({
 *   collection: 'posts',
 *   where: { status: { equals: 'published' } },
 * });
 * ```
 */
export interface CountArgs<TSlug extends CollectionSlug = CollectionSlug>
  extends DirectAPIConfig {
  /** Collection slug (required) */
  collection: TSlug;

  /** Query conditions for filtering */
  where?: WhereFilter;

  /**
   * As {@link FindArgs.frameworkFilter}. A count is a CLEANER oracle than a
   * listing -- it answers 1 or 0 for a guessed value and returns no row to
   * redact -- so the same exemption has to be expressible here and nowhere
   * looser.
   */
  frameworkFilter?: true;

  /**
   * As {@link FindArgs.status}, and present for the same reason a count mirrors
   * every other one of `find`'s filters: the total has to describe the rows a
   * list would return. Without it an untrusted count silently answers
   * `published` only -- `resolveStatusFilter`'s default for a caller that
   * states nothing -- so `count()` and `find({ status: "all" }).meta.total`
   * disagree about one collection, and neither says why.
   *
   * The query service has always accepted this; only the Direct API dropped it.
   */
  status?: "published" | "draft" | "all";
}

/**
 * Arguments for bulk deleting multiple documents by IDs.
 *
 * @example
 * ```typescript
 * const result = await nextly.bulkDelete({
 *   collection: 'posts',
 *   ids: ['post-1', 'post-2', 'post-3'],
 * });
 * ```
 */
export interface BulkDeleteArgs<TSlug extends CollectionSlug = CollectionSlug>
  extends DirectAPIConfig {
  /** Collection slug (required) */
  collection: TSlug;

  /** Array of document IDs to delete (required) */
  ids: string[];

  /**
   * Skip cache revalidation for this bulk delete (the outbox drain still runs).
   * Set by a CLI, seed, or bulk-import caller that owns its cache strategy.
   *
   * @default false
   */
  disableRevalidate?: boolean;
}

/**
 * Arguments for duplicating a document.
 *
 * @example
 * ```typescript
 * const duplicate = await nextly.duplicate({
 *   collection: 'posts',
 *   id: 'post-123',
 *   overrides: { title: 'Copy of Original' },
 * });
 * ```
 */
export interface DuplicateArgs<TSlug extends CollectionSlug = CollectionSlug>
  extends DirectAPIConfig {
  /** Collection slug (required) */
  collection: TSlug;

  /** ID of document to duplicate (required) */
  id: string;

  /**
   * Field overrides to apply to the duplicate.
   *
   * These values override the copied data.
   */
  overrides?: Record<string, unknown>;

  /**
   * Skip cache revalidation for this duplicate (the outbox drain still runs).
   * Set by a CLI, seed, or bulk-import caller that owns its cache strategy.
   *
   * @default false
   */
  disableRevalidate?: boolean;
}

/**
 * Result of a count operation.
 *
 * the wire API's `respondCount` envelope both speak the same key.
 */
export interface CountResult {
  /** Total number of documents matching the query */
  total: number;
}

/**
 * Result of a delete-by-id or delete-by-where operation.
 *
 * `delete()` calls return `{ message, item }` (`MutationResult`) so they
 * match the wire API's `respondMutation` envelope. `DeleteResult` is still
 * used for the bulk-by-where path where multiple IDs may be returned.
 */
export interface DeleteResult {
  /** Whether the delete was successful */
  deleted: boolean;

  /** IDs of deleted documents */
  ids: string[];

  /**
   * Side effects that failed after the rows were deleted, when any did.
   *
   * Present only when a post-commit hook threw. The rows are gone either way,
   * so this reports a side effect that did not run rather than a failed
   * delete. Mirrors `MutationResult.warnings`, so a delete by `where` reports
   * a hook failure the same way a delete by id does.
   */
  warnings?: HookWarning[];
}

/**
 * Result of a bulk operation with partial success support.
 *
 * Phase 4.5: redesigned to carry full success records (not just ids) and
 * structured per-item failures keyed by canonical NextlyErrorCode. The
 * direct-API surface mirrors the wire shape emitted by respondBulk so
 * direct-API callers and HTTP callers see the same data on the success
 * path.
 *
 * Generic over T:
 *   - For delete: T is `{ id: string }`.
 *   - For update/create: T is the full record.
 */
export interface BulkOperationResult<T = { id: string }> {
  /** Records successfully processed. */
  successes: T[];

  /** Structured per-item failures. */
  failures: Array<{
    /** Identifier of the entry that failed. */
    id: string;
    /** Canonical NextlyErrorCode value. */
    code: string;
    /** Public-safe message (no identifier or value echo). */
    message: string;
  }>;

  /** Total number of documents processed. */
  total: number;

  /** Number of successful operations. */
  successCount: number;

  /** Number of failed operations. */
  failedCount: number;

  /**
   * Side effects that failed after the rows were written, when any did.
   *
   * Distinct from `failures`, which is per-ITEM and means that item did not
   * happen. This is per-OPERATION: every listed success is durable, and a hook
   * that ran after the write threw. Reporting one as the other would tell a
   * caller a saved row failed and invite a retry that writes it twice.
   */
  warnings?: HookWarning[];
}
