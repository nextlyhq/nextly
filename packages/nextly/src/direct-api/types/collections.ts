/**
 * Direct API Collection Type Definitions
 *
 * Argument and result types for collection CRUD, counting, and bulk operations.
 *
 * @packageDocumentation
 */

import type {
  CollectionSlug,
  DirectAPIConfig,
  PopulateOptions,
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
  where?: import("../../services/collections/query-operators").WhereFilter;

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
  where?: import("../../services/collections/query-operators").WhereFilter;

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
  where?: import("../../services/collections/query-operators").WhereFilter;
}

/**
 * Arguments for counting documents in a collection.
 *
 * @example
 * ```typescript
 * // Phase 4 (Task 13): count() now returns `{ total }` (was `{ totalDocs }`).
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
  where?: import("../../services/collections/query-operators").WhereFilter;
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
}

/**
 * Result of a count operation.
 *
 * Phase 4 (Task 13): renamed `totalDocs` to `total` so the Direct API and
 * the wire API's `respondCount` envelope both speak the same key.
 */
export interface CountResult {
  /** Total number of documents matching the query */
  total: number;
}

/**
 * Result of a delete-by-id or delete-by-where operation.
 *
 * Phase 4 (Task 13): the top-level `nextly.delete(...)` and per-namespace
 * `delete()` calls return `{ message, item }` (`MutationResult`) so they
 * match the wire API's `respondMutation` envelope. `DeleteResult` is still
 * used for the bulk-by-where path where multiple IDs may be returned.
 */
export interface DeleteResult {
  /** Whether the delete was successful */
  deleted: boolean;

  /** IDs of deleted documents */
  ids: string[];
}

/**
 * Result of a bulk operation with partial success support.
 */
export interface BulkOperationResult {
  /** IDs of successfully processed documents */
  success: string[];

  /** Details of failed operations */
  failed: Array<{
    id: string;
    error: string;
  }>;

  /** Total number of documents processed */
  total: number;

  /** Number of successful operations */
  successCount: number;

  /** Number of failed operations */
  failedCount: number;
}
