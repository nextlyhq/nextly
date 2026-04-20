/**
 * Shared types for collection domain services.
 *
 * These types were originally defined in collection-entry-service.ts and are
 * used across all split services (access, hook, query, mutation, bulk).
 */

/**
 * Service result type for legacy format compatibility.
 * Used by collection services for consistent response structure.
 *
 * @public
 */
export interface CollectionServiceResult<T = unknown> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T | null;
}

/**
 * User context for access control.
 *
 * Contains the minimum user information needed for evaluating access rules.
 * Passed to CRUD methods to enable collection-level access control.
 *
 * @public
 */
export interface UserContext {
  /** Unique user identifier */
  id: string;
  /** User's role (required for role-based access rules) */
  role?: string;
  /** User's display name (optional, for logging/auditing) */
  name?: string;
  /** User's email address (optional, for logging/auditing) */
  email?: string;
  /** Additional user data passed from the request */
  [key: string]: unknown;
}

/**
 * Result of a bulk operation (create, update, or delete).
 *
 * Tracks successful and failed operations with detailed error information
 * for each failed entry. Uses partial success pattern where some operations
 * may succeed while others fail.
 *
 * @public
 */
export interface BulkOperationResult {
  /** IDs of entries successfully processed */
  success: string[];
  /** Detailed information for each failed entry */
  failed: Array<{ id: string; error: string }>;
  /** Total number of entries attempted */
  total: number;
  /** Count of successful operations */
  successCount: number;
  /** Count of failed operations */
  failedCount: number;
}

/**
 * Result from batch entry operations (createEntries, updateEntries, deleteEntries).
 *
 * Uses index-based error tracking for operations on arrays of entries.
 *
 * @public
 */
export interface BatchOperationResult {
  /** Number of entries successfully processed */
  successful: number;
  /** Number of entries that failed */
  failed: number;
  /** IDs of successfully created/updated entries */
  ids: string[];
  /** Detailed error information for each failed entry */
  errors: Array<{ index: number; error: string }>;
}

/**
 * Options for bulk operations (create, update, delete).
 *
 * @public
 */
export interface BulkOperationOptions {
  /**
   * Number of entries to process in each batch.
   * Larger batches are more efficient but use more memory.
   * @default 100
   */
  batchSize?: number;
  /**
   * If true, stops processing and rolls back the entire transaction
   * when any entry fails. If false, continues processing remaining entries.
   * @default false
   */
  stopOnError?: boolean;
  /**
   * If true, skips hook execution (beforeCreate/afterCreate, etc.)
   * for each entry. Useful for high-performance imports.
   * @default false
   */
  skipHooks?: boolean;
}

/**
 * @deprecated Use BulkOperationOptions instead
 */
export type BulkCreateOptions = BulkOperationOptions;

/**
 * Entry for bulk update operations.
 *
 * Contains the ID of the entry to update and the data to apply.
 * Supports partial updates - only specified fields will be modified.
 *
 * @public
 */
export interface BulkUpdateEntry {
  /** ID of the entry to update */
  id: string;
  /** Partial data to update (only specified fields will be modified) */
  data: Record<string, unknown>;
}
