/**
 * Shared Types
 *
 * Common types and interfaces used across all Nextly services.
 * Services receive dependencies via constructor injection and use these
 * shared types for consistent request handling and data structures.
 *
 * @module shared/types
 * @since 1.0.0
 */

/**
 * Type alias for Drizzle database instance.
 * Using `any` because the concrete Drizzle type varies by dialect
 * (NodePgDatabase, MySql2Database, BetterSQLite3Database).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleDB = any;

/**
 * Request context passed to service methods.
 * Contains user information, locale, and request metadata.
 *
 * @example
 * ```typescript
 * const context: RequestContext = {
 *   user: {
 *     id: 'user_abc123',
 *     email: 'user@example.com',
 *     role: 'editor',
 *     permissions: ['posts:read', 'posts:write'],
 *   },
 *   locale: 'en',
 *   requestId: 'req_xyz789',
 * };
 *
 * await collectionService.create('posts', input, context);
 * ```
 */
export interface RequestContext {
  /**
   * Authenticated user information.
   * Undefined for unauthenticated requests.
   */
  user?: {
    /** User ID (UUID or CUID format) */
    id: string;
    /** User email address */
    email: string;
    /** User's primary role */
    role: string;
    /** Permission codes the user has (e.g., 'posts:read', 'posts:write') */
    permissions: string[];
  };
  /** Request locale for i18n (e.g., 'en', 'es', 'fr') */
  locale?: string;
  /** Unique request identifier for tracing/logging */
  requestId?: string;
}

/**
 * System context for internal/CLI operations.
 * Use this when performing operations that don't have a user context,
 * such as migrations, seeders, or CLI commands.
 *
 * @example
 * ```typescript
 * // In a migration or seeder
 * await userService.create(adminUserData, SYSTEM_CONTEXT);
 * ```
 */
export const SYSTEM_CONTEXT: RequestContext = {
  user: {
    id: "system",
    email: "system@nextly.local",
    role: "admin",
    permissions: ["*"],
  },
};

/**
 * Pagination options for list queries.
 *
 * @example
 * ```typescript
 * const options: PaginationOptions = {
 *   limit: 20,
 *   offset: 40, // Skip first 40 records (page 3)
 * };
 * // Or using page-based pagination
 * const pageOptions: PaginationOptions = {
 *   limit: 20,
 *   page: 3, // Will be converted to offset: 40
 * };
 * ```
 */
export interface PaginationOptions {
  /** Maximum number of records to return (default varies by service) */
  limit?: number;
  /** Number of records to skip */
  offset?: number;
  /** Page number (1-indexed, alternative to offset) */
  page?: number;
}

/**
 * Paginated result wrapper for list operations.
 *
 * @template T - The type of items in the data array
 *
 * @example
 * ```typescript
 * const result: PaginatedResult<User> = {
 *   data: [user1, user2, user3],
 *   pagination: {
 *     total: 100,
 *     limit: 10,
 *     offset: 0,
 *     hasMore: true,
 *   },
 * };
 * ```
 */
export interface PaginatedResult<T> {
  /** Array of items for the current page */
  data: T[];
  /** Pagination metadata */
  pagination: {
    /** Total number of records matching the query */
    total: number;
    /** Number of records per page */
    limit: number;
    /** Number of records skipped */
    offset: number;
    /** Whether there are more records after this page */
    hasMore: boolean;
  };
}

/**
 * Sort options for list queries.
 *
 * @example
 * ```typescript
 * const sort: SortOptions = {
 *   field: 'createdAt',
 *   direction: 'desc',
 * };
 * ```
 */
export interface SortOptions {
  /** Field name to sort by */
  field: string;
  /** Sort direction */
  direction: "asc" | "desc";
}

/**
 * Common query options combining pagination, sorting, and filtering.
 *
 * @example
 * ```typescript
 * const options: QueryOptions = {
 *   pagination: { limit: 20, page: 1 },
 *   sort: { field: 'createdAt', direction: 'desc' },
 *   where: { status: 'published' },
 * };
 *
 * const results = await collectionService.findMany('posts', options, context);
 * ```
 */
export interface QueryOptions {
  /** Pagination settings */
  pagination?: PaginationOptions;
  /** Sort settings */
  sort?: SortOptions;
  /** Filter conditions (key-value pairs) */
  where?: Record<string, unknown>;
}

/**
 * Service dependencies interface.
 * Services receive dependencies via constructor injection.
 *
 * @example
 * ```typescript
 * class MyService {
 *   constructor(private deps: ServiceDeps) {}
 *
 *   async doSomething() {
 *     const result = await this.deps.db.select()...
 *     this.deps.logger?.info('Operation completed');
 *   }
 * }
 * ```
 */
export interface ServiceDeps {
  /** Drizzle database instance */
  db: DrizzleDB;
  /** Optional logger instance */
  logger?: Logger;
}

/**
 * Logger interface for service logging.
 * Compatible with common logging libraries (winston, pino, etc.)
 *
 * @example
 * ```typescript
 * const logger: Logger = {
 *   debug: (msg, meta) => console.debug(`[DEBUG] ${msg}`, meta),
 *   info: (msg, meta) => console.info(`[INFO] ${msg}`, meta),
 *   warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta),
 *   error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta),
 * };
 * ```
 */
export interface Logger {
  /** Log debug-level message */
  debug(message: string, meta?: Record<string, unknown>): void;
  /** Log info-level message */
  info(message: string, meta?: Record<string, unknown>): void;
  /** Log warning-level message */
  warn(message: string, meta?: Record<string, unknown>): void;
  /** Log error-level message */
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Default console logger implementation.
 * Provides a simple logger that outputs to console.
 * Use this as a fallback when no custom logger is configured.
 *
 * @example
 * ```typescript
 * import { consoleLogger } from '@revnixhq/nextly';
 *
 * const service = new MyService({
 *   db,
 *   logger: consoleLogger, // or your custom logger
 * });
 * ```
 */
export const consoleLogger: Logger = {
  debug: (msg, meta) => console.debug(`[DEBUG] ${msg}`, meta ?? ""),
  info: (msg, meta) => console.info(`[INFO] ${msg}`, meta ?? ""),
  warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta ?? ""),
  error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta ?? ""),
};

// Access control types (shared across collections, singles, auth)
export * from "./access";

// Database adapter type (used by BaseService generic)
export * from "./database-adapter";
