/**
 * @nextly/adapter-drizzle - Type Definitions
 *
 * Comprehensive type definitions for the unified database adapter interface.
 * These types are designed to be database-agnostic while supporting the full
 * feature set needed by Nextly services.
 *
 * @remarks
 * Mostly types, but not only: the error guards and `WHERE_OPERATORS` are runtime
 * values, so a consumer importing those needs a value import rather than
 * `import type`.
 *
 * @example
 * ```typescript
 * import type {
 *   DatabaseAdapter,
 *   TransactionContext,
 *   WhereClause,
 *   SelectOptions
 * } from '@nextly/adapter-drizzle/types';
 *
 * import { WHERE_OPERATORS, isDatabaseError } from '@nextly/adapter-drizzle/types';
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

// The operator list is a VALUE, so that callers validating input against it and the type that
// narrows that input cannot disagree — the type is derived from this array.
export { WHERE_OPERATORS } from "./query";

// ============================================================
// CRUD Operation Types
// ============================================================
export type {
  CountOptions,
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

export {
  isDatabaseError,
  createDatabaseError,
  isApplicationError,
} from "./error";

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
