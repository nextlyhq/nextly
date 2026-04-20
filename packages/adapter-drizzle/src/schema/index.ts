/**
 * Schema utilities for @nextly/adapter-drizzle
 *
 * @remarks
 * This module re-exports schema-related types from the `/types` subpath
 * and will contain schema builder utilities in Phase 4 (Task 4.1).
 *
 * ## Current Exports
 *
 * - **Schema Type Definitions:** {@link TableDefinition}, {@link ColumnDefinition}, {@link IndexDefinition}, {@link TableConstraint}
 * - **Schema Operation Types:** {@link CreateTableOptions}, {@link DropTableOptions}, {@link AlterTableOptions}, {@link AlterTableOperation}
 * - **Core Types:** {@link SqlParam}
 *
 * ## Coming in Phase 4
 *
 * - Schema builder utilities
 * - Schema generator functions
 * - Dialect-specific schema mapping
 * - Unified schema definitions
 *
 * ## Usage Examples
 *
 * ### Defining a Table Schema
 *
 * ```typescript
 * import type { TableDefinition } from "@nextly/adapter-drizzle/schema";
 *
 * const usersTable: TableDefinition = {
 *   name: "users",
 *   columns: [
 *     { name: "id", type: "uuid", primaryKey: true },
 *     { name: "email", type: "varchar(255)", unique: true },
 *     { name: "name", type: "varchar(255)", nullable: true },
 *     {
 *       name: "created_at",
 *       type: "timestamp",
 *       default: { sql: "CURRENT_TIMESTAMP" },
 *     },
 *   ],
 *   indexes: [
 *     { name: "users_email_idx", columns: ["email"], unique: true },
 *   ],
 * };
 * ```
 *
 * ### Creating a Table with Adapter
 *
 * ```typescript
 * import type { DrizzleAdapter } from "@nextly/adapter-drizzle";
 * import type { TableDefinition } from "@nextly/adapter-drizzle/schema";
 *
 * async function createUsersTable(adapter: DrizzleAdapter) {
 *   const tableDefinition: TableDefinition = {
 *     // ... table definition
 *   };
 *
 *   await adapter.createTable(tableDefinition, { ifNotExists: true });
 * }
 * ```
 *
 * ### Altering a Table
 *
 * ```typescript
 * import type {
 *   AlterTableOperation,
 *   ColumnDefinition,
 * } from "@nextly/adapter-drizzle/schema";
 *
 * const operations: AlterTableOperation[] = [
 *   {
 *     kind: "add_column",
 *     column: { name: "age", type: "int", nullable: true },
 *   },
 *   {
 *     kind: "rename_column",
 *     from: "name",
 *     to: "full_name",
 *   },
 * ];
 *
 * await adapter.alterTable("users", operations);
 * ```
 *
 * @packageDocumentation
 */

// ============================================================
// Schema Type Re-exports
// ============================================================

/**
 * Column definition for schema operations.
 *
 * @remarks
 * Defines the structure of a database column in a database-agnostic way.
 * Adapters translate these definitions to dialect-specific DDL.
 *
 * @example
 * ```typescript
 * const idColumn: ColumnDefinition = {
 *   name: "id",
 *   type: "uuid",
 *   primaryKey: true,
 * };
 *
 * const emailColumn: ColumnDefinition = {
 *   name: "email",
 *   type: "varchar(255)",
 *   unique: true,
 * };
 * ```
 *
 * @public
 */
export type { ColumnDefinition } from "../types/schema";

/**
 * Index definition for schema operations.
 *
 * @remarks
 * Defines database indexes for performance optimization.
 *
 * @example
 * ```typescript
 * const emailIndex: IndexDefinition = {
 *   name: "users_email_idx",
 *   columns: ["email"],
 *   unique: true,
 * };
 * ```
 *
 * @public
 */
export type { IndexDefinition } from "../types/schema";

/**
 * Table constraint definition.
 *
 * @example
 * ```typescript
 * const checkConstraint: TableConstraint = {
 *   name: "check_age_positive",
 *   type: "check",
 *   expression: "age >= 0",
 * };
 * ```
 *
 * @public
 */
export type { TableConstraint } from "../types/schema";

/**
 * Complete table definition.
 *
 * @remarks
 * Defines the complete structure of a database table including columns,
 * indexes, and constraints.
 *
 * @example
 * ```typescript
 * const postsTable: TableDefinition = {
 *   name: "posts",
 *   columns: [
 *     { name: "id", type: "uuid", primaryKey: true },
 *     { name: "title", type: "varchar(255)" },
 *     { name: "content", type: "text" },
 *     { name: "published", type: "boolean", default: false },
 *   ],
 *   indexes: [
 *     { name: "posts_title_idx", columns: ["title"] },
 *   ],
 * };
 * ```
 *
 * @public
 */
export type { TableDefinition } from "../types/schema";

/**
 * Options for table creation.
 *
 * @example
 * ```typescript
 * const options: CreateTableOptions = {
 *   ifNotExists: true,
 *   temporary: false,
 * };
 *
 * await adapter.createTable(tableDefinition, options);
 * ```
 *
 * @public
 */
export type { CreateTableOptions } from "../types/schema";

/**
 * Options for table dropping.
 *
 * @example
 * ```typescript
 * const options: DropTableOptions = {
 *   ifExists: true,
 *   cascade: true,
 * };
 *
 * await adapter.dropTable("old_table", options);
 * ```
 *
 * @public
 */
export type { DropTableOptions } from "../types/schema";

/**
 * Options for table alteration.
 *
 * @public
 */
export type { AlterTableOptions } from "../types/schema";

/**
 * Table alteration operations.
 *
 * @remarks
 * Defines the types of operations that can be performed when altering a table.
 *
 * @example
 * ```typescript
 * const operations: AlterTableOperation[] = [
 *   {
 *     kind: "add_column",
 *     column: { name: "status", type: "varchar(20)", default: "draft" },
 *   },
 *   {
 *     kind: "drop_column",
 *     columnName: "old_field",
 *   },
 *   {
 *     kind: "add_constraint",
 *     constraint: {
 *       name: "check_status",
 *       type: "check",
 *       expression: "status IN ('draft', 'published')",
 *     },
 *   },
 * ];
 *
 * await adapter.alterTable("posts", operations);
 * ```
 *
 * @public
 */
export type { AlterTableOperation } from "../types/schema";

// ============================================================
// Core Type Re-exports
// ============================================================

/**
 * SQL parameter type (for use in column defaults, etc.).
 *
 * @remarks
 * Represents values that can be safely passed as SQL parameters.
 *
 * @public
 */
export type { SqlParam } from "../types/core";

// ============================================================
// Module Metadata
// ============================================================

/**
 * Schema utilities version.
 *
 * @remarks
 * This version tracks the schema utilities module independently
 * from the main adapter package version.
 *
 * @internal
 */
export const SCHEMA_VERSION = "0.1.0" as const;

/**
 * Indicates whether schema builder utilities are available.
 *
 * @remarks
 * Currently `false` - schema builder utilities will be implemented
 * in Phase 4, Task 4.1 of the database adapter plan.
 *
 * @internal
 */
export const SCHEMA_BUILDER_AVAILABLE = false as const;
