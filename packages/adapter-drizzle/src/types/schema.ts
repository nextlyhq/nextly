/**
 * Database schema type definitions.
 *
 * @packageDocumentation
 */

import type { SqlParam } from "./core";

/**
 * Column definition for schema operations.
 *
 * @remarks
 * Defines the structure of a database column in a database-agnostic way.
 * Adapters translate these definitions to dialect-specific DDL.
 *
 * @public
 */
export interface ColumnDefinition {
  /** Column name */
  name: string;

  /**
   * Column data type.
   *
   * @remarks
   * Common types across databases:
   * - Text: varchar(n), text, char(n)
   * - Numbers: int, bigint, decimal, numeric
   * - Boolean: boolean
   * - Date/Time: timestamp, date, time
   * - JSON: json, jsonb (PostgreSQL)
   * - UUID: uuid (PostgreSQL), char(36) (MySQL/SQLite)
   *
   * Adapters handle dialect-specific type mapping.
   */
  type: string;

  /** Allow NULL values (default: true) */
  nullable?: boolean;

  /** Primary key column */
  primaryKey?: boolean;

  /** Unique constraint */
  unique?: boolean;

  /** Default value (literal or SQL expression) */
  default?: SqlParam | { sql: string };

  /** Foreign key reference */
  references?: {
    /** Referenced table name */
    table: string;

    /** Referenced column name */
    column: string;

    /** Action on DELETE */
    onDelete?:
      | "no action"
      | "restrict"
      | "cascade"
      | "set null"
      | "set default";

    /** Action on UPDATE */
    onUpdate?:
      | "no action"
      | "restrict"
      | "cascade"
      | "set null"
      | "set default";
  };

  /** Check constraint expression */
  check?: string;

  /** Generated column definition (computed column) */
  generated?: {
    /** SQL expression to generate the value */
    as: string;

    /** Store the value (true) or compute on-the-fly (false) */
    stored?: boolean;
  };
}

/**
 * Index definition for schema operations.
 *
 * @remarks
 * Defines database indexes for performance optimization.
 *
 * @public
 */
export interface IndexDefinition {
  /** Index name */
  name: string;

  /** Columns included in the index */
  columns: string[];

  /** Unique index (enforces uniqueness) */
  unique?: boolean;

  /** Partial index condition (WHERE clause) */
  where?: string;

  /** Index type (database-specific) */
  using?: "btree" | "hash" | "gin" | "gist" | "brin";
}

/**
 * Table constraint definition.
 *
 * @public
 */
export interface TableConstraint {
  /** Constraint name */
  name: string;

  /** Constraint type */
  type: "unique" | "check" | "foreign_key" | "primary_key";

  /** Columns involved in the constraint */
  columns?: string[];

  /** Check constraint expression */
  expression?: string;

  /** Foreign key reference (for foreign_key type) */
  references?: {
    /** Referenced table name */
    table: string;

    /** Referenced columns */
    columns: string[];

    /** Action on DELETE */
    onDelete?:
      | "no action"
      | "restrict"
      | "cascade"
      | "set null"
      | "set default";

    /** Action on UPDATE */
    onUpdate?:
      | "no action"
      | "restrict"
      | "cascade"
      | "set null"
      | "set default";
  };
}

/**
 * Complete table definition.
 *
 * @remarks
 * Defines the complete structure of a database table including columns,
 * indexes, and constraints.
 *
 * @public
 */
export interface TableDefinition {
  /** Table name */
  name: string;

  /** Column definitions */
  columns: ColumnDefinition[];

  /** Composite primary key (if not defined at column level) */
  primaryKey?: string[];

  /** Index definitions */
  indexes?: IndexDefinition[];

  /** Table-level constraints */
  constraints?: TableConstraint[];

  /** Table comment/description */
  comment?: string;
}

/**
 * Options for table creation.
 *
 * @public
 */
export interface CreateTableOptions {
  /** Don't throw error if table exists */
  ifNotExists?: boolean;

  /** Temporary table (session-scoped) */
  temporary?: boolean;
}

/**
 * Options for table dropping.
 *
 * @public
 */
export interface DropTableOptions {
  /** Don't throw error if table doesn't exist */
  ifExists?: boolean;

  /** Drop dependent objects (CASCADE) */
  cascade?: boolean;

  /** Restrict drop if dependencies exist (default) */
  restrict?: boolean;
}

/**
 * Options for table alteration.
 *
 * @public
 */
export interface AlterTableOptions {
  /** Validation mode for constraints */
  validate?: boolean;
}

/**
 * Table alteration operations.
 *
 * @remarks
 * Defines the types of operations that can be performed when altering a table.
 *
 * @public
 */
export type AlterTableOperation =
  | { kind: "add_column"; column: ColumnDefinition }
  | { kind: "drop_column"; columnName: string; cascade?: boolean }
  | { kind: "rename_column"; from: string; to: string }
  | { kind: "modify_column"; column: ColumnDefinition }
  | { kind: "add_constraint"; constraint: TableConstraint }
  | { kind: "drop_constraint"; constraintName: string; cascade?: boolean };
