/**
 * Core type definitions for the Nextly database adapter system.
 *
 * These types are the foundation for all database operations and are designed
 * to be database-agnostic while supporting dialect-specific features.
 *
 * @packageDocumentation
 */

/**
 * Supported database dialects.
 *
 * @remarks
 * These are the database systems that Nextly officially supports through
 * dedicated adapter packages.
 *
 * @public
 */
export type SupportedDialect = "postgresql" | "mysql" | "sqlite";

/**
 * SQL parameter types that are safe to use across all database dialects.
 *
 * @remarks
 * - `undefined` is included for optional parameters
 * - `Date` objects will be converted to appropriate format per dialect
 * - `null` represents SQL NULL
 *
 * @public
 */
export type SqlParam = string | number | boolean | Date | null | undefined;

/**
 * JSON value types that can be stored in JSON/JSONB columns.
 *
 * @remarks
 * Represents the valid JSON value types as defined by the JSON specification.
 * This is a recursive type to support nested objects and arrays.
 *
 * @public
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * JSON object type for structured data.
 *
 * @remarks
 * Useful for typed JSON column data where the structure is known.
 *
 * @public
 */
export type JsonObject = { [key: string]: JsonValue };

/**
 * JSON array type.
 *
 * @public
 */
export type JsonArray = JsonValue[];

/**
 * Interface for resolving table names to Drizzle table objects.
 *
 * @remarks
 * When a TableResolver is set on the adapter via `setTableResolver()`,
 * CRUD methods will use Drizzle's query API instead of raw SQL string building.
 * The nextly SchemaRegistry implements this interface.
 *
 * @public
 */
export interface TableResolver {
  /** Look up a Drizzle table object by table name. Returns null if not found. */
  getTable(tableName: string): unknown;
}
