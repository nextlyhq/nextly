/**
 * @nextly/adapter-drizzle - Type Definitions
 *
 * Comprehensive type definitions for the unified database adapter interface.
 * These types are designed to be database-agnostic while supporting the full
 * feature set needed by Nextly services.
 *
 * @remarks
 * This module provides type-only exports. Import specific types as needed:
 *
 * @example
 * ```typescript
 * import type {
 *   DatabaseAdapter,
 *   TransactionContext,
 *   WhereClause,
 *   SelectOptions
 * } from '@nextly/adapter-drizzle/types';
 * ```
 *
 * @packageDocumentation
 */

// ============================================================
// Core Types
// ============================================================
export type {
  SupportedDialect,
  SqlParam,
  JsonValue,
  JsonObject,
  JsonArray,
  TableResolver,
} from "./core";

// ============================================================
// Query Building Types
// ============================================================
export type {
  WhereOperator,
  WhereCondition,
  WhereClause,
  OrderBySpec,
  JoinSpec,
} from "./query";

// ============================================================
// CRUD Operation Types
// ============================================================
export type {
  SelectOptions,
  InsertOptions,
  UpdateOptions,
  DeleteOptions,
  UpsertOptions,
} from "./crud";

// ============================================================
// Transaction Types
// ============================================================
export type {
  TransactionIsolationLevel,
  TransactionOptions,
  TransactionContext,
} from "./transaction";

// ============================================================
// Capability Types
// ============================================================
export type { DatabaseCapabilities, PoolStats } from "./capabilities";

// ============================================================
// Migration Types
// ============================================================
export type {
  Migration,
  MigrationRecord,
  MigrationResult,
  MigrationOptions,
  MigrationStatus,
} from "./migration";

// ============================================================
// Schema Types
// ============================================================
export type {
  ColumnDefinition,
  IndexDefinition,
  TableConstraint,
  TableDefinition,
  CreateTableOptions,
  DropTableOptions,
  AlterTableOptions,
  AlterTableOperation,
} from "./schema";

// ============================================================
// Error Types
// ============================================================
export type {
  DatabaseErrorKind,
  DatabaseError,
  DatabaseErrorOptions,
} from "./error";

export { isDatabaseError, createDatabaseError } from "./error";

// ============================================================
// Configuration Types
// ============================================================
export type {
  AdapterLogger,
  PoolConfig,
  SslConfig,
  BaseAdapterConfig,
  PostgresAdapterConfig,
  MySqlAdapterConfig,
  SqliteAdapterConfig,
} from "./config";
