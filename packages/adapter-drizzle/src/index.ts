/**
 * @nextly/adapter-drizzle
 *
 * Shared Drizzle ORM adapter logic for Nextly database adapters.
 * This package provides the base adapter class and utilities used by
 * dialect-specific adapters (PostgreSQL, MySQL, SQLite).
 *
 * @remarks
 * This is the main entry point that exports only the core adapter class.
 * Specialized utilities are available via subpath exports for optimal tree-shaking.
 *
 * ## Subpath Exports
 *
 * **Types:**
 * ```typescript
 * import type {
 *   DatabaseCapabilities,
 *   TransactionContext,
 *   WhereClause,
 *   SelectOptions,
 * } from '@nextly/adapter-drizzle/types';
 * ```
 *
 * **Query Builder:**
 * ```typescript
 * import { QueryBuilder } from '@nextly/adapter-drizzle/query-builder';
 * ```
 *
 * **Migrations:**
 * ```typescript
 * import {
 *   calculateChecksum,
 *   sortMigrations,
 *   migrationHelpers,
 * } from '@nextly/adapter-drizzle/migrations';
 * ```
 *
 * **Schema Utilities:**
 * ```typescript
 * import { schemaUtils } from '@nextly/adapter-drizzle/schema';
 * ```
 *
 * @packageDocumentation
 */

/**
 * Package version
 * @public
 */
export const version = "0.1.0";

// ============================================================
// Core Adapter Export
// ============================================================

/**
 * Base database adapter abstract class.
 *
 * @remarks
 * All dialect-specific adapters extend this class. It provides:
 * - Abstract methods that must be implemented (connect, disconnect, executeQuery, transaction)
 * - Default CRUD implementations that can be overridden for optimization
 * - Protected query builders for dialect-specific SQL generation
 * - Error handling and database capability reporting
 *
 * ## Required Abstract Methods
 * - `dialect` - Database dialect identifier
 * - `connect()` - Establish database connection
 * - `disconnect()` - Close database connection
 * - `executeQuery()` - Execute raw SQL query
 * - `transaction()` - Execute work within a transaction
 * - `getCapabilities()` - Report database features
 *
 * ## Default CRUD Methods (Overridable)
 * - `select()`, `selectOne()` - Query records
 * - `insert()`, `insertMany()` - Insert records
 * - `update()` - Update records
 * - `delete()` - Delete records
 * - `upsert()` - Insert or update records
 *
 * @example
 * Basic adapter implementation:
 * ```typescript
 * import { DrizzleAdapter } from '@nextly/adapter-drizzle';
 * import type {
 *   DatabaseCapabilities,
 *   SqlParam,
 *   TransactionContext,
 * } from '@nextly/adapter-drizzle/types';
 *
 * export class PostgresAdapter extends DrizzleAdapter {
 *   readonly dialect = 'postgresql' as const;
 *
 *   async connect(): Promise<void> {
 *     // Connect to PostgreSQL
 *   }
 *
 *   async disconnect(): Promise<void> {
 *     // Close connection
 *   }
 *
 *   async executeQuery<T>(sql: string, params?: SqlParam[]): Promise<T[]> {
 *     // Execute query
 *   }
 *
 *   async transaction<T>(
 *     work: (tx: TransactionContext) => Promise<T>
 *   ): Promise<T> {
 *     // Transaction logic
 *   }
 *
 *   getCapabilities(): DatabaseCapabilities {
 *     return {
 *       dialect: 'postgresql',
 *       supportsJsonb: true,
 *       supportsReturning: true,
 *       // ... other capabilities
 *     };
 *   }
 * }
 * ```
 *
 * @public
 */
export { DrizzleAdapter } from "./adapter";
export type { TableResolver } from "./types/core";

// Why no F17 re-exports here: the main index follows a strict tree-shaking
// policy (only DrizzleAdapter + version are exported). F17's
// checkDialectVersion / NEXTLY_MIN_DB_VERSIONS / UnsupportedDialectVersionError
// live behind the dedicated subpath @revnixhq/adapter-drizzle/version-check.
