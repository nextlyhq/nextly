// Free-function home for the "add missing columns to an existing table"
// helper. Extracted from SchemaPushService.addMissingColumnsForFields in
// F8 PR 1 so the legacy SchemaPushService class could be deleted in
// F8 PR 4 without losing this single useful utility.
//
// Why a util and not the pipeline: the boot-time singles + components
// auto-sync paths in cli/commands/dev-server.ts need an INCREMENTAL
// "add what's missing" step. The new applyDesiredSchema pipeline does a
// full diff + apply, and currently iterates only desired.collections —
// it does not yet model singles + components at apply time. Until a
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
// will replace this with Drizzle-driven DDL.

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldConfig } from "../../../collections/fields/types/index";
import { isBuiltInFieldType } from "../../../schemas/_zod/ui-schema";
import type { FieldDefinition } from "../../../schemas/dynamic-collections/legacy-types";
import type { Logger } from "../../../shared/types/index";
import type { SupportedDialect } from "../../../types/database";
import {
  fieldProducesColumn,
  getColumnDescriptor,
  type ColumnOrigin,
} from "../services/field-column-descriptor";
import { pluginStorageFieldType } from "../services/plugin-codegen";

// Convert camelCase / PascalCase identifiers to snake_case column names.
// Mirrors the original helper from SchemaPushService.
function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

/**
 * The DDL type for a field, taken from the descriptor the ORM binds.
 *
 * `getColumnDescriptor` is the single statement of what a column holds — the
 * runtime schema generator dispatches on its `kind` — so a path that names its
 * own types can disagree with the columns the app actually reads and writes.
 * Only the kinds this file needs are mapped; an unmapped kind returns nothing
 * so the caller keeps the type it already emitted.
 */
function ddlTypeForKind(
  field: FieldConfig,
  dialect: string,
  builtBy: ColumnOrigin
): string | undefined {
  const descriptor = getColumnDescriptor(
    field as unknown as FieldDefinition,
    dialect as SupportedDialect,
    builtBy
  );
  if (!descriptor) return undefined;

  switch (descriptor.kind) {
    case "integer":
      return "INTEGER";
    case "double":
      return dialect === "postgresql"
        ? "DOUBLE PRECISION"
        : dialect === "mysql"
          ? "DOUBLE"
          : "REAL";
    case "decimal": {
      // The dimensions come from the descriptor too. Stated here, a field
      // declaring NUMERIC(18,6) got NUMERIC(10,2) when added to an existing
      // table — rounding what it stored and refusing what it used to accept —
      // while a fresh table and the runtime binding both honoured it.
      const { precision, scale } = descriptor;
      const dimensions =
        precision !== undefined && scale !== undefined
          ? `(${precision},${scale})`
          : "";
      return dialect === "mysql"
        ? `DECIMAL${dimensions}`
        : `NUMERIC${dimensions}`;
    }
    case "text": {
      // Only the slug column. It is indexed by every generator that creates one, and MySQL cannot
      // index an unbounded string, so a slug ADDed to an existing table has to arrive bounded or it
      // cannot carry the index a freshly created table gives it.
      //
      // Every other `text` field deliberately keeps the TEXT below. Aligning those with the
      // descriptor's `varchar(255)` is a real reduction in what the column can hold and is a
      // separate decision, tracked on its own rather than taken as a side effect here.
      if (toSnakeCase(String(field.name)) !== "slug") return undefined;
      // Matches what the descriptor renders: bounded only where the dialect has a bounded string
      // AND needs one.
      return dialect === "mysql"
        ? `VARCHAR(${descriptor.length ?? 255})`
        : "TEXT";
    }
    case "shortText": {
      // The one string kind that is not TEXT everywhere. Stated here because a column this path
      // adds to an existing table is read back by the same descriptor the ORM binds: emitting TEXT
      // for it left the next preview reporting a type change on a column boot had just created.
      //
      // Only for a type this schema names. A field group's creator deletes `options` from a
      // contributed type before mapping it — a plugin's options are its own, and one that happens
      // to be called `variant` must not reshape the column — so it builds such a field as TEXT.
      // Bounding it here would report a type change on the column that creator had just made, which
      // is the same defect in the opposite direction. Deciding it correctly needs to know which
      // entity is being built, which this helper is not told.
      if (!("type" in field) || !isBuiltInFieldType(String(field.type))) {
        return undefined;
      }
      // SQLite has one string type, so the bound lives in validation there and TEXT is correct.
      if (dialect === "sqlite") return "TEXT";
      return `VARCHAR(${descriptor.length ?? 255})`;
    }
    case "timestamp":
      // Only SQLite routes here; it stores a timestamp as an integer.
      return dialect === "sqlite" ? "INTEGER" : undefined;
    case "json":
      return dialect === "postgresql"
        ? "JSONB"
        : dialect === "mysql"
          ? "JSON"
          : "TEXT";
    default:
      return undefined;
  }
}

// Render a FieldConfig into the column part of an ALTER TABLE statement,
// e.g. `"title" TEXT NOT NULL` or `\`is_published\` TINYINT(1) DEFAULT FALSE`.
// Returns null when the field can't be rendered (e.g. no name).
//
// Each branch is the day-one type mapping; do not change behavior here
// without a migration story for existing user data.
export function fieldToColumnDef(
  field: FieldConfig,
  dialect: string,
  // Which builder made the table this column is being added to. A column added later must match the
  // one a fresh table gets, and the two Schema Builder creators size a text column differently.
  builtBy: ColumnOrigin
): string | null {
  if (!("name" in field) || !field.name) {
    return null;
  }

  // Field-group and component fields store their data in separate tables and are
  // stripped from the parent row on write, so they get no parent column.
  if (!fieldProducesColumn(field)) {
    return null;
  }

  const name = toSnakeCase(field.name);
  const required = "required" in field && field.required;
  const quotedName = dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

  let columnType: string;
  let defaultValue: string | null = null;

  // A plugin-contributed type matches no case below and would fall to the TEXT
  // fallback, so a field added to an existing table would get a text column
  // while the same field on a fresh table gets its storage primitive. Resolved
  // to that primitive first so both paths agree.
  const storageType = pluginStorageFieldType(field);
  const mappedType = storageType ?? field.type;

  switch (mappedType) {
    case "text":
    case "email":
    case "code":
    case "textarea":
      // A field that declared its own width gets the bounded column the descriptor binds and a
      // freshly created table gets; every other string field keeps TEXT, which is what the
      // descriptor says for them on all three dialects.
      columnType = ddlTypeForKind(field, dialect, builtBy) ?? "TEXT";
      break;

    case "number":
      // Derived from the descriptor rather than stated here, because the
      // descriptor is what the ORM binds and what a freshly created table
      // gets. Stated independently, this branch emitted NUMERIC/DECIMAL/REAL
      // while the binder read an integer, so the same field had one storage
      // class when the table was created and another when it was added later.
      // The descriptor also honours the two ways a field asks for fractions —
      // `dbType: "decimal"` and `options.format: "float"` — which a fixed
      // string here silently overrode in both directions.
      columnType = ddlTypeForKind(field, dialect, builtBy) ?? "INTEGER";
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
      // SQLite binds a timestamp as an integer, so the TEXT this branch used
      // to emit could not be read back by the binder that wrote it. Postgres
      // and MySQL keep the types they already had; only the storage class the
      // ORM disagreed with changes.
      columnType =
        dialect === "postgresql"
          ? "TIMESTAMP WITH TIME ZONE"
          : dialect === "mysql"
            ? "DATETIME"
            : (ddlTypeForKind(field, dialect, builtBy) ?? "INTEGER");
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
    case "chips":
      columnType =
        dialect === "postgresql"
          ? "JSONB"
          : dialect === "mysql"
            ? "JSON"
            : "TEXT";
      break;

    case "password":
      columnType = "TEXT";
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
      //
      // .trimEnd() collapses the trailing space the regex leaves when
      // the original colDef ended with `... NOT NULL` (one of three
      // produced shapes). Pure SQL no-op on every dialect; tests assert
      // the cleaned shape.
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
  options: { timestamps?: boolean; builtBy: ColumnOrigin }
): Promise<string[]> {
  const dialect = adapter.getCapabilities().dialect as string;
  const columns = new Map<string, string>();

  for (const field of fields) {
    if ("name" in field && field.name) {
      const colDef = fieldToColumnDef(field, dialect, options.builtBy);
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
