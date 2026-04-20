/**
 * Schema Generator - Dialect-Specific SQL DDL Generation
 *
 * This module provides utilities to generate SQL DDL statements from
 * database-agnostic `TableDefinition` objects. It handles type mapping
 * between abstract types (e.g., "jsonb", "serial", "text[]") and
 * dialect-specific SQL types for PostgreSQL, MySQL, and SQLite.
 *
 * @remarks
 * The generator follows a "closest equivalent with warning" strategy for
 * unsupported features. When a feature isn't natively supported by a dialect,
 * it maps to the closest equivalent and logs a warning.
 *
 * @example
 * ```typescript
 * import { generateCreateTableSql, generateSchemaForDialect } from "./generator";
 * import { nextlyTables } from "./unified";
 *
 * // Generate CREATE TABLE for a single table
 * const sql = generateCreateTableSql(nextlyTables[0], "postgresql");
 *
 * // Generate all DDL for a dialect
 * const schema = generateSchemaForDialect(nextlyTables, "mysql");
 * for (const tableSql of schema.tables) {
 *   await adapter.executeQuery(tableSql);
 * }
 * ```
 *
 * @packageDocumentation
 */

import type {
  TableDefinition,
  ColumnDefinition,
  IndexDefinition,
  TableConstraint,
  SupportedDialect,
} from "@revnixhq/adapter-drizzle/types";

// ============================================================
// Type Mapping
// ============================================================

/**
 * Type mapping configuration for each dialect.
 *
 * Maps abstract type names to dialect-specific SQL types.
 * Types not in this map are passed through as-is.
 */
const TYPE_MAPPINGS: Record<SupportedDialect, Record<string, string>> = {
  postgresql: {
    // PostgreSQL uses native types - minimal mapping needed
    serial: "SERIAL",
    bigserial: "BIGSERIAL",
    text: "TEXT",
    varchar: "VARCHAR",
    integer: "INTEGER",
    int: "INTEGER",
    bigint: "BIGINT",
    boolean: "BOOLEAN",
    timestamp: "TIMESTAMP",
    timestamptz: "TIMESTAMPTZ",
    date: "DATE",
    time: "TIME",
    jsonb: "JSONB",
    json: "JSON",
    uuid: "UUID",
    "text[]": "TEXT[]",
    real: "REAL",
    "double precision": "DOUBLE PRECISION",
    numeric: "NUMERIC",
    decimal: "DECIMAL",
  },
  mysql: {
    serial: "INT AUTO_INCREMENT",
    bigserial: "BIGINT AUTO_INCREMENT",
    text: "TEXT",
    varchar: "VARCHAR",
    integer: "INT",
    int: "INT",
    bigint: "BIGINT",
    boolean: "TINYINT(1)",
    timestamp: "TIMESTAMP",
    timestamptz: "TIMESTAMP", // MySQL doesn't have separate timestamptz
    date: "DATE",
    time: "TIME",
    jsonb: "JSON", // MySQL has JSON but not JSONB
    json: "JSON",
    uuid: "CHAR(36)", // MySQL doesn't have native UUID
    "text[]": "JSON", // MySQL doesn't have native arrays
    real: "FLOAT",
    "double precision": "DOUBLE",
    numeric: "DECIMAL",
    decimal: "DECIMAL",
  },
  sqlite: {
    serial: "INTEGER", // SQLite uses INTEGER PRIMARY KEY for auto-increment
    bigserial: "INTEGER",
    text: "TEXT",
    varchar: "TEXT", // SQLite doesn't enforce varchar length
    integer: "INTEGER",
    int: "INTEGER",
    bigint: "INTEGER", // SQLite stores all integers as INTEGER
    boolean: "INTEGER", // SQLite uses 0/1 for boolean
    timestamp: "TEXT", // SQLite stores timestamps as TEXT (ISO8601)
    timestamptz: "TEXT",
    date: "TEXT",
    time: "TEXT",
    jsonb: "TEXT", // SQLite stores JSON as TEXT
    json: "TEXT",
    uuid: "TEXT", // SQLite stores UUID as TEXT
    "text[]": "TEXT", // SQLite stores arrays as JSON in TEXT
    real: "REAL",
    "double precision": "REAL",
    numeric: "NUMERIC",
    decimal: "NUMERIC",
  },
};

/**
 * Features that require warnings when mapped to fallback types.
 */
const FEATURE_WARNINGS: Record<
  string,
  Record<SupportedDialect, string | null>
> = {
  jsonb: {
    postgresql: null,
    mysql: "jsonb mapped to JSON for MySQL (no native JSONB support)",
    sqlite:
      "jsonb mapped to TEXT for SQLite (no native JSON type, use JSON functions)",
  },
  "text[]": {
    postgresql: null,
    mysql: "text[] mapped to JSON for MySQL (no native array support)",
    sqlite:
      "text[] mapped to TEXT for SQLite (no native array support, store as JSON)",
  },
  uuid: {
    postgresql: null,
    mysql: "uuid mapped to CHAR(36) for MySQL (no native UUID type)",
    sqlite: "uuid mapped to TEXT for SQLite (no native UUID type)",
  },
  boolean: {
    postgresql: null,
    mysql: null, // TINYINT(1) is standard for MySQL
    sqlite: "boolean mapped to INTEGER for SQLite (use 0/1)",
  },
  timestamp: {
    postgresql: null,
    mysql: null,
    sqlite: "timestamp mapped to TEXT for SQLite (store as ISO8601 string)",
  },
};

/**
 * Maps an abstract column type to a dialect-specific SQL type.
 *
 * @param type - The abstract type (e.g., "jsonb", "varchar(255)", "text[]")
 * @param dialect - The target database dialect
 * @param logWarnings - Whether to log warnings for fallback mappings (default: true)
 * @returns The dialect-specific SQL type
 *
 * @example
 * ```typescript
 * mapColumnType("jsonb", "postgresql"); // "JSONB"
 * mapColumnType("jsonb", "mysql");      // "JSON" (with warning)
 * mapColumnType("varchar(100)", "sqlite"); // "TEXT"
 * ```
 */
export function mapColumnType(
  type: string,
  dialect: SupportedDialect,
  logWarnings = true
): string {
  const lowerType = type.toLowerCase();
  const mappings = TYPE_MAPPINGS[dialect];

  // Handle types with parameters (e.g., varchar(255), numeric(10,2))
  const baseTypeMatch = lowerType.match(/^(\w+)(\(.+\))?$/);
  if (baseTypeMatch) {
    const [, baseType, params] = baseTypeMatch;
    const mappedBase = mappings[baseType];

    if (mappedBase) {
      // Log warning if this is a fallback mapping
      if (logWarnings) {
        const warning = FEATURE_WARNINGS[baseType]?.[dialect];
        if (warning) {
          console.warn(`[Schema Generator] ${warning}`);
        }
      }

      // For types that don't use parameters in target dialect
      if (dialect === "sqlite" && ["varchar", "text"].includes(baseType)) {
        return mappedBase; // SQLite ignores varchar length
      }

      // Preserve parameters for types that support them
      if (
        params &&
        ["varchar", "char", "numeric", "decimal"].includes(baseType)
      ) {
        return `${mappedBase}${params.toUpperCase()}`;
      }

      return mappedBase;
    }
  }

  // Direct mapping lookup
  if (mappings[lowerType]) {
    if (logWarnings) {
      const warning = FEATURE_WARNINGS[lowerType]?.[dialect];
      if (warning) {
        console.warn(`[Schema Generator] ${warning}`);
      }
    }
    return mappings[lowerType];
  }

  // Pass through unknown types as-is (uppercase)
  return type.toUpperCase();
}

// ============================================================
// SQL Generation Utilities
// ============================================================

/**
 * Escapes an identifier (table/column name) for the given dialect.
 */
function escapeIdentifier(name: string, dialect: SupportedDialect): string {
  switch (dialect) {
    case "mysql":
      return `\`${name}\``;
    case "postgresql":
    case "sqlite":
    default:
      return `"${name}"`;
  }
}

/**
 * Formats a default value for SQL.
 */
function formatDefaultValue(
  defaultVal: ColumnDefinition["default"],
  dialect: SupportedDialect
): string {
  if (defaultVal === null || defaultVal === undefined) {
    return "";
  }

  // SQL expression default (e.g., CURRENT_TIMESTAMP)
  if (typeof defaultVal === "object" && "sql" in defaultVal) {
    const sqlExpr = defaultVal.sql;

    // Normalize CURRENT_TIMESTAMP across dialects
    if (
      sqlExpr.toUpperCase() === "CURRENT_TIMESTAMP" ||
      sqlExpr.toUpperCase() === "NOW()"
    ) {
      switch (dialect) {
        case "postgresql":
          return "DEFAULT CURRENT_TIMESTAMP";
        case "mysql":
          return "DEFAULT CURRENT_TIMESTAMP";
        case "sqlite":
          return "DEFAULT CURRENT_TIMESTAMP";
      }
    }

    return `DEFAULT ${sqlExpr}`;
  }

  // Literal values
  if (typeof defaultVal === "string") {
    return `DEFAULT '${defaultVal.replace(/'/g, "''")}'`;
  }
  if (typeof defaultVal === "number") {
    return `DEFAULT ${defaultVal}`;
  }
  if (typeof defaultVal === "boolean") {
    switch (dialect) {
      case "postgresql":
        return `DEFAULT ${defaultVal}`;
      case "mysql":
        return `DEFAULT ${defaultVal ? 1 : 0}`;
      case "sqlite":
        return `DEFAULT ${defaultVal ? 1 : 0}`;
    }
  }

  return "";
}

/**
 * Generates the column definition SQL.
 */
function generateColumnSql(
  column: ColumnDefinition,
  dialect: SupportedDialect,
  isSerialPrimaryKey: boolean
): string {
  const parts: string[] = [];

  // Column name
  parts.push(escapeIdentifier(column.name, dialect));

  // Handle serial/auto-increment for primary keys
  if (isSerialPrimaryKey && column.type.toLowerCase() === "serial") {
    switch (dialect) {
      case "postgresql":
        parts.push("SERIAL PRIMARY KEY");
        return parts.join(" ");
      case "mysql":
        parts.push("INT AUTO_INCREMENT PRIMARY KEY");
        return parts.join(" ");
      case "sqlite":
        // SQLite requires INTEGER PRIMARY KEY for auto-increment
        parts.push("INTEGER PRIMARY KEY AUTOINCREMENT");
        return parts.join(" ");
    }
  }

  // Column type
  parts.push(mapColumnType(column.type, dialect));

  // Primary key (non-serial)
  if (column.primaryKey && column.type.toLowerCase() !== "serial") {
    parts.push("PRIMARY KEY");
  }

  // NOT NULL constraint
  if (column.nullable === false) {
    parts.push("NOT NULL");
  }

  // UNIQUE constraint
  if (column.unique) {
    parts.push("UNIQUE");
  }

  // Default value
  const defaultSql = formatDefaultValue(column.default, dialect);
  if (defaultSql) {
    parts.push(defaultSql);
  }

  // CHECK constraint
  if (column.check) {
    parts.push(`CHECK (${column.check})`);
  }

  // Foreign key reference (inline)
  if (column.references) {
    const ref = column.references;
    let refSql = `REFERENCES ${escapeIdentifier(ref.table, dialect)}(${escapeIdentifier(ref.column, dialect)})`;

    if (ref.onDelete) {
      refSql += ` ON DELETE ${ref.onDelete.toUpperCase()}`;
    }
    if (ref.onUpdate) {
      refSql += ` ON UPDATE ${ref.onUpdate.toUpperCase()}`;
    }

    parts.push(refSql);
  }

  // Generated column
  if (column.generated) {
    const stored = column.generated.stored ? "STORED" : "VIRTUAL";
    switch (dialect) {
      case "postgresql":
        parts.push(`GENERATED ALWAYS AS (${column.generated.as}) ${stored}`);
        break;
      case "mysql":
        parts.push(`AS (${column.generated.as}) ${stored}`);
        break;
      case "sqlite":
        parts.push(`GENERATED ALWAYS AS (${column.generated.as}) ${stored}`);
        break;
    }
  }

  return parts.join(" ");
}

// ============================================================
// DDL Generation Functions
// ============================================================

/**
 * Generates a CREATE TABLE SQL statement from a TableDefinition.
 *
 * @param table - The table definition
 * @param dialect - The target database dialect
 * @param options - Generation options
 * @returns The CREATE TABLE SQL statement
 *
 * @example
 * ```typescript
 * const sql = generateCreateTableSql(usersTable, "postgresql");
 * // CREATE TABLE "users" (
 * //   "id" TEXT PRIMARY KEY,
 * //   "email" TEXT NOT NULL,
 * //   ...
 * // );
 * ```
 */
export function generateCreateTableSql(
  table: TableDefinition,
  dialect: SupportedDialect,
  options: { ifNotExists?: boolean } = {}
): string {
  const tableName = escapeIdentifier(table.name, dialect);
  const ifNotExists = options.ifNotExists ? "IF NOT EXISTS " : "";

  // Generate column definitions
  const columnDefs = table.columns.map(col => {
    const isSerialPk =
      col.primaryKey === true && col.type.toLowerCase() === "serial";
    return "  " + generateColumnSql(col, dialect, isSerialPk);
  });

  // Add composite primary key if specified at table level
  if (table.primaryKey && table.primaryKey.length > 0) {
    const pkColumns = table.primaryKey
      .map(col => escapeIdentifier(col, dialect))
      .join(", ");
    columnDefs.push(`  PRIMARY KEY (${pkColumns})`);
  }

  // Add table-level constraints
  if (table.constraints) {
    for (const constraint of table.constraints) {
      columnDefs.push("  " + generateConstraintSql(constraint, dialect));
    }
  }

  const createSql = `CREATE TABLE ${ifNotExists}${tableName} (\n${columnDefs.join(",\n")}\n)`;

  // Add table comment for PostgreSQL
  let commentSql = "";
  if (table.comment && dialect === "postgresql") {
    commentSql = `;\nCOMMENT ON TABLE ${tableName} IS '${table.comment.replace(/'/g, "''")}'`;
  }

  return createSql + commentSql + ";";
}

/**
 * Generates a table constraint SQL fragment.
 */
function generateConstraintSql(
  constraint: TableConstraint,
  dialect: SupportedDialect
): string {
  const name = escapeIdentifier(constraint.name, dialect);

  switch (constraint.type) {
    case "primary_key":
      if (constraint.columns) {
        const cols = constraint.columns
          .map(c => escapeIdentifier(c, dialect))
          .join(", ");
        return `CONSTRAINT ${name} PRIMARY KEY (${cols})`;
      }
      break;

    case "unique":
      if (constraint.columns) {
        const cols = constraint.columns
          .map(c => escapeIdentifier(c, dialect))
          .join(", ");
        return `CONSTRAINT ${name} UNIQUE (${cols})`;
      }
      break;

    case "check":
      if (constraint.expression) {
        return `CONSTRAINT ${name} CHECK (${constraint.expression})`;
      }
      break;

    case "foreign_key":
      if (constraint.columns && constraint.references) {
        const cols = constraint.columns
          .map(c => escapeIdentifier(c, dialect))
          .join(", ");
        const refTable = escapeIdentifier(constraint.references.table, dialect);
        const refCols = constraint.references.columns
          .map(c => escapeIdentifier(c, dialect))
          .join(", ");

        let fkSql = `CONSTRAINT ${name} FOREIGN KEY (${cols}) REFERENCES ${refTable}(${refCols})`;

        if (constraint.references.onDelete) {
          fkSql += ` ON DELETE ${constraint.references.onDelete.toUpperCase()}`;
        }
        if (constraint.references.onUpdate) {
          fkSql += ` ON UPDATE ${constraint.references.onUpdate.toUpperCase()}`;
        }

        return fkSql;
      }
      break;
  }

  return "";
}

/**
 * Generates CREATE INDEX SQL statements for a table.
 *
 * @param table - The table definition
 * @param dialect - The target database dialect
 * @returns Array of CREATE INDEX SQL statements
 *
 * @example
 * ```typescript
 * const indexes = generateIndexSql(usersTable, "postgresql");
 * // ["CREATE UNIQUE INDEX \"users_email_unique\" ON \"users\" (\"email\");", ...]
 * ```
 */
export function generateIndexSql(
  table: TableDefinition,
  dialect: SupportedDialect
): string[] {
  if (!table.indexes || table.indexes.length === 0) {
    return [];
  }

  return table.indexes.map(index =>
    generateSingleIndexSql(index, table.name, dialect)
  );
}

/**
 * Generates a single CREATE INDEX statement.
 */
function generateSingleIndexSql(
  index: IndexDefinition,
  tableName: string,
  dialect: SupportedDialect
): string {
  const indexName = escapeIdentifier(index.name, dialect);
  const tableRef = escapeIdentifier(tableName, dialect);
  const columns = index.columns
    .map(c => escapeIdentifier(c, dialect))
    .join(", ");

  const unique = index.unique ? "UNIQUE " : "";

  // Index type (USING clause) - PostgreSQL specific
  let usingClause = "";
  if (index.using && dialect === "postgresql") {
    usingClause = ` USING ${index.using}`;
  }

  // Partial index (WHERE clause)
  let whereClause = "";
  if (index.where) {
    whereClause = ` WHERE ${index.where}`;
  }

  return `CREATE ${unique}INDEX ${indexName} ON ${tableRef}${usingClause} (${columns})${whereClause};`;
}

/**
 * Generates a DROP TABLE SQL statement.
 *
 * @param tableName - The table name
 * @param dialect - The target database dialect
 * @param options - Drop options
 * @returns The DROP TABLE SQL statement
 */
export function generateDropTableSql(
  tableName: string,
  dialect: SupportedDialect,
  options: { ifExists?: boolean; cascade?: boolean } = {}
): string {
  const name = escapeIdentifier(tableName, dialect);
  const ifExists = options.ifExists ? "IF EXISTS " : "";
  const cascade = options.cascade && dialect !== "sqlite" ? " CASCADE" : "";

  return `DROP TABLE ${ifExists}${name}${cascade};`;
}

// ============================================================
// Batch Generation
// ============================================================

/**
 * Result of schema generation for a dialect.
 */
export interface SchemaGenerationResult {
  /** CREATE TABLE statements */
  tables: string[];
  /** CREATE INDEX statements */
  indexes: string[];
  /** All statements in execution order (tables first, then indexes) */
  all: string[];
  /** Dialect used */
  dialect: SupportedDialect;
  /** Number of tables processed */
  tableCount: number;
  /** Number of indexes processed */
  indexCount: number;
}

/**
 * Generates all DDL statements for a set of tables.
 *
 * @param tables - Array of table definitions
 * @param dialect - The target database dialect
 * @param options - Generation options
 * @returns Object containing tables, indexes, and combined SQL arrays
 *
 * @example
 * ```typescript
 * import { generateSchemaForDialect } from "./generator";
 * import { nextlyTables } from "./unified";
 *
 * const schema = generateSchemaForDialect(nextlyTables, "postgresql");
 *
 * // Execute all DDL
 * for (const sql of schema.all) {
 *   await adapter.executeQuery(sql);
 * }
 *
 * console.log(`Created ${schema.tableCount} tables and ${schema.indexCount} indexes`);
 * ```
 */
export function generateSchemaForDialect(
  tables: TableDefinition[],
  dialect: SupportedDialect,
  options: { ifNotExists?: boolean } = {}
): SchemaGenerationResult {
  const tableStatements: string[] = [];
  const indexStatements: string[] = [];

  for (const table of tables) {
    // Generate CREATE TABLE
    tableStatements.push(generateCreateTableSql(table, dialect, options));

    // Generate CREATE INDEX statements
    const indexes = generateIndexSql(table, dialect);
    indexStatements.push(...indexes);
  }

  return {
    tables: tableStatements,
    indexes: indexStatements,
    all: [...tableStatements, ...indexStatements],
    dialect,
    tableCount: tables.length,
    indexCount: indexStatements.length,
  };
}

/**
 * Generates DROP TABLE statements for all tables (in reverse order for FK dependencies).
 *
 * @param tables - Array of table definitions
 * @param dialect - The target database dialect
 * @param options - Drop options
 * @returns Array of DROP TABLE statements in reverse dependency order
 */
export function generateDropSchemaForDialect(
  tables: TableDefinition[],
  dialect: SupportedDialect,
  options: { ifExists?: boolean; cascade?: boolean } = {
    ifExists: true,
    cascade: true,
  }
): string[] {
  // Reverse order to handle foreign key dependencies
  return [...tables]
    .reverse()
    .map(table => generateDropTableSql(table.name, dialect, options));
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Gets the list of supported dialects.
 */
export function getSupportedDialects(): SupportedDialect[] {
  return ["postgresql", "mysql", "sqlite"];
}

/**
 * Checks if a type is supported natively by a dialect.
 *
 * @param type - The abstract type to check
 * @param dialect - The target dialect
 * @returns True if the type is natively supported, false if it requires fallback
 */
export function isTypeNativelySupported(
  type: string,
  dialect: SupportedDialect
): boolean {
  const warning = FEATURE_WARNINGS[type.toLowerCase()]?.[dialect];
  return warning === null || warning === undefined;
}

/**
 * Gets the type mapping for a specific dialect.
 *
 * @param dialect - The target dialect
 * @returns Record of abstract type to dialect-specific type mappings
 */
export function getTypeMappings(
  dialect: SupportedDialect
): Record<string, string> {
  return { ...TYPE_MAPPINGS[dialect] };
}
