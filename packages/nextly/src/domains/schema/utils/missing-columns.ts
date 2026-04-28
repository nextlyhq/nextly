// Free-function home for the "add missing columns to an existing table"
// helper. Extracted from SchemaPushService.addMissingColumnsForFields in
// F8 PR 1 so the legacy SchemaPushService class can be deleted in PR 4
// without losing this single useful utility.
//
// Why a util and not the pipeline: the boot-time singles + components
// auto-sync paths in cli/commands/dev-server.ts need an INCREMENTAL
// "add what's missing" step. The new applyDesiredSchema pipeline does a
// full diff + apply, and currently iterates only desired.collections —
// it does not yet model singles + components at apply time. Until a
// future task collapses the three boot-time sync functions into one
// pipeline call, this helper preserves day-one behavior verbatim:
//
//   - Per-dialect ALTER TABLE ADD COLUMN with quoted identifiers.
//   - Silently strips NOT NULL on every added column. Adding NOT NULL to
//     a column on a table with existing rows would fail the whole ALTER.
//     Application-layer Zod validation enforces required-on-new-rows;
//     the DB constraint can be tightened later via an explicit migration.
//   - Idempotent: skips columns that already exist.
//   - Per-column failures log a warning and continue (best-effort).
//
// The raw `ALTER TABLE` SQL is technically a `feedback_drizzle_only`
// violation. The violation already exists in the codebase; we are
// relocating it, not introducing it. The future pipeline-collapse task
// will replace this with Drizzle-driven DDL.

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import type { FieldConfig } from "../../../collections/fields/types/index.js";
import type { Logger } from "../../../shared/types/index.js";

// Convert camelCase / PascalCase identifiers to snake_case column names.
// Mirrors the original helper from SchemaPushService.
function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

// Render a FieldConfig into the column part of an ALTER TABLE statement,
// e.g. `"title" TEXT NOT NULL` or `\`is_published\` TINYINT(1) DEFAULT FALSE`.
// Returns null when the field can't be rendered (e.g. no name).
//
// Each branch is the day-one type mapping; do not change behavior here
// without a migration story for existing user data.
function fieldToColumnDef(field: FieldConfig, dialect: string): string | null {
  if (!("name" in field) || !field.name) {
    return null;
  }

  const name = toSnakeCase(field.name);
  const required = "required" in field && field.required;
  const quotedName = dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

  let columnType: string;
  let defaultValue: string | null = null;

  switch (field.type) {
    case "text":
    case "email":
    case "code":
    case "textarea":
      columnType = "TEXT";
      break;

    case "number":
      columnType =
        dialect === "postgresql"
          ? "NUMERIC"
          : dialect === "mysql"
            ? "DECIMAL(10,2)"
            : "REAL";
      break;

    case "checkbox": {
      columnType =
        dialect === "postgresql"
          ? "BOOLEAN"
          : dialect === "mysql"
            ? "TINYINT(1)"
            : "INTEGER";
      const checkboxDefault = (field as { defaultValue?: boolean })
        .defaultValue;
      defaultValue = checkboxDefault === true ? "TRUE" : "FALSE";
      break;
    }

    case "date":
      columnType =
        dialect === "postgresql"
          ? "TIMESTAMP WITH TIME ZONE"
          : dialect === "mysql"
            ? "DATETIME"
            : "TEXT";
      break;

    case "select":
      columnType = "TEXT";
      break;

    case "relationship":
    case "upload": {
      const hasMany = (field as { hasMany?: boolean }).hasMany;
      const relationTo = (field as { relationTo?: unknown }).relationTo;
      if (hasMany || Array.isArray(relationTo)) {
        // hasMany or polymorphic — store as JSON array.
        columnType =
          dialect === "postgresql"
            ? "JSONB"
            : dialect === "mysql"
              ? "JSON"
              : "TEXT";
      } else {
        // Single foreign key reference.
        columnType = dialect === "postgresql" ? "UUID" : "TEXT";
      }
      break;
    }

    case "richText":
    case "json":
    case "repeater":
    case "group":
      columnType =
        dialect === "postgresql"
          ? "JSONB"
          : dialect === "mysql"
            ? "JSON"
            : "TEXT";
      break;

    default:
      // Unknown field type — fall back to TEXT so the migration succeeds.
      columnType = "TEXT";
  }

  let def = `${quotedName} ${columnType}`;
  if (defaultValue !== null) {
    def += ` DEFAULT ${defaultValue}`;
  }
  if (required) {
    def += " NOT NULL";
  }
  return def;
}

// Read the existing column names from the live DB for a given table.
// Returns an empty set on unsupported dialects so the caller treats every
// requested column as missing (safe — the ALTER will fail loudly).
async function getExistingColumns(
  adapter: DrizzleAdapter,
  tableName: string
): Promise<Set<string>> {
  const dialect = adapter.getCapabilities().dialect;
  let sql: string;
  const params: (string | number | boolean | null)[] = [];

  switch (dialect) {
    case "postgresql":
      sql = `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`;
      params.push(tableName);
      break;
    case "mysql":
      sql = `SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?`;
      params.push(tableName);
      break;
    case "sqlite":
      sql = `PRAGMA table_info("${tableName}")`;
      break;
    default:
      return new Set();
  }

  const rows = await adapter.executeQuery<Record<string, unknown>>(sql, params);
  const columns = new Set<string>();
  for (const row of rows) {
    // SQLite uses 'name', PG/MySQL use 'column_name'.
    const col = (row.column_name ?? row.name) as string | undefined;
    if (col) columns.add(col);
  }
  return columns;
}

// Issue ALTER TABLE ADD COLUMN for every entry in `expectedColumns` that
// isn't already present on the table. Returns the names of columns that
// were successfully added.
async function addMissingColumnsFromMap(
  adapter: DrizzleAdapter,
  logger: Logger,
  tableName: string,
  expectedColumns: Map<string, string>
): Promise<string[]> {
  const dialect = adapter.getCapabilities().dialect as string;
  const existingColumns = await getExistingColumns(adapter, tableName);
  const addedColumns: string[] = [];
  const quotedTable =
    dialect === "mysql" ? `\`${tableName}\`` : `"${tableName}"`;

  for (const [colName, colDef] of expectedColumns) {
    // Empty colDef = system column (id, timestamps) created with the table.
    if (!existingColumns.has(colName) && colDef) {
      // Strip NOT NULL when adding to an existing table that may have
      // data. Existing rows would have NULL for the new column, which
      // violates NOT NULL. The application layer (Zod) enforces required
      // fields on new entries; the DB constraint can be tightened later
      // via an explicit migration once existing rows are backfilled.
      const safeDef = colDef.replace(/\s+NOT\s+NULL\s*/gi, " ").trimEnd();
      const sql = `ALTER TABLE ${quotedTable} ADD COLUMN ${safeDef}`;
      try {
        await adapter.executeQuery(sql);
        addedColumns.push(colName);
      } catch (error) {
        logger.warn(
          `Failed to add column ${colName} to ${tableName}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  return addedColumns;
}

/**
 * Add the columns that are missing from `tableName` so it matches the
 * given `fields` config. Used by the boot-time singles + components
 * auto-sync paths. NOT NULL is silently stripped on every added column;
 * pre-existing rows would otherwise fail the constraint check.
 *
 * @param adapter   The Drizzle adapter for the live DB.
 * @param logger    Logger for per-column failure warnings.
 * @param tableName The physical table name (e.g. `single_homepage`).
 * @param fields    Field configs to materialise.
 * @param options   `timestamps` defaults to true and ensures
 *                  `created_at` / `updated_at` are present in the
 *                  expected-column set so the introspection skip works.
 * @returns         Names of columns that were added in this call.
 */
export async function addMissingColumnsForFields(
  adapter: DrizzleAdapter,
  logger: Logger,
  tableName: string,
  fields: FieldConfig[],
  options?: { timestamps?: boolean }
): Promise<string[]> {
  const dialect = adapter.getCapabilities().dialect as string;
  const columns = new Map<string, string>();

  for (const field of fields) {
    if ("name" in field && field.name) {
      const colDef = fieldToColumnDef(field, dialect);
      if (colDef) {
        columns.set(toSnakeCase(field.name), colDef);
      }
    }
  }

  // Timestamps are always created with the table; record them in the
  // expected set with empty defs so the ALTER skip filter sees them as
  // "already covered" rather than "missing column with nothing to add".
  if (options?.timestamps !== false) {
    columns.set("created_at", "");
    columns.set("updated_at", "");
  }

  return addMissingColumnsFromMap(adapter, logger, tableName, columns);
}
