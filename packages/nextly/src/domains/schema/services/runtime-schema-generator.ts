/**
 * Runtime Schema Generator
 *
 * Generates Drizzle ORM table schemas at runtime from field definitions.
 * This is used for UI-created collections that don't have pre-compiled TypeScript schemas.
 *
 * Phase 5 (2026-05-01): per-field type mapping is delegated to
 * `field-column-descriptor.ts` so that this generator and the diff
 * engine's `build-from-fields.ts` stay in lockstep. Adding a new field
 * type means updating the descriptor module; this file just translates
 * the descriptor's `kind` to the right Drizzle column builder.
 *
 * @module services/schema/runtime-schema-generator
 */

import {
  mysqlTable,
  text as mysqlText,
  boolean as mysqlBoolean,
  timestamp as mysqlTimestamp,
  json as mysqlJson,
  varchar as mysqlVarchar,
  double as mysqlDouble,
} from "drizzle-orm/mysql-core";
import {
  pgTable,
  text as pgText,
  boolean as pgBoolean,
  timestamp as pgTimestamp,
  jsonb as pgJsonb,
  doublePrecision as pgDoublePrecision,
  varchar as pgVarchar,
} from "drizzle-orm/pg-core";
import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
  real as sqliteReal,
} from "drizzle-orm/sqlite-core";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";

import {
  type ColumnDescriptor,
  type ColumnKind,
  type SupportedDialect as DescriptorDialect,
  getColumnDescriptor,
  getSystemColumnDescriptors,
} from "./field-column-descriptor";

export type SupportedDialect = DescriptorDialect;

// Return type for generateRuntimeSchema - provides the Drizzle table object
// and a schemaRecord keyed by table name for pushSchema() consumption.
export interface RuntimeSchemaResult {
  table: unknown; // PgTable | MySqlTable | SqliteTable
  schemaRecord: Record<string, unknown>; // { [tableName]: table } for pushSchema()
}

/**
 * Toggles that affect which system columns are injected into the runtime
 * Drizzle table — must stay in lockstep with `buildDesiredTableFromFields`'s
 * options so the runtime schema matches the diff descriptor's view.
 */
export interface RuntimeSchemaOptions {
  /** When true, inject a `status` column ('draft' | 'published', default 'draft'). */
  status?: boolean;
}

/**
 * Generate a Drizzle table schema at runtime from field definitions.
 *
 * @param tableName - The database table name (should include dc_ prefix)
 * @param fields - Array of field definitions from the collection
 * @param dialect - Database dialect (postgresql, mysql, sqlite)
 * @param options - Optional system-column toggles (status etc.)
 * @returns RuntimeSchemaResult with table object and schemaRecord for pushSchema()
 */
export function generateRuntimeSchema(
  tableName: string,
  fields: FieldDefinition[],
  dialect: SupportedDialect,
  options: RuntimeSchemaOptions = {}
): RuntimeSchemaResult {
  let table: unknown;
  switch (dialect) {
    case "postgresql":
      table = generatePostgresSchema(tableName, fields, options);
      break;
    case "mysql":
      table = generateMySQLSchema(tableName, fields, options);
      break;
    case "sqlite":
      table = generateSQLiteSchema(tableName, fields, options);
      break;
    default:
      throw new Error(`Unsupported dialect: ${String(dialect)}`);
  }
  return {
    table,
    schemaRecord: { [tableName]: table },
  };
}

function generatePostgresSchema(
  tableName: string,
  fields: FieldDefinition[],
  options: RuntimeSchemaOptions
): unknown {
  const columns = buildDrizzleColumnRecord(fields, "postgresql", options);
  return pgTable(tableName, columns);
}

function generateMySQLSchema(
  tableName: string,
  fields: FieldDefinition[],
  options: RuntimeSchemaOptions
): unknown {
  const columns = buildDrizzleColumnRecord(fields, "mysql", options);
  return mysqlTable(tableName, columns);
}

function generateSQLiteSchema(
  tableName: string,
  fields: FieldDefinition[],
  options: RuntimeSchemaOptions
): unknown {
  const columns = buildDrizzleColumnRecord(fields, "sqlite", options);
  return sqliteTable(tableName, columns);
}

/**
 * Builds the dialect-keyed column record consumed by Drizzle's
 * pgTable / mysqlTable / sqliteTable. Both system columns and
 * user-field columns flow through `field-column-descriptor.ts`
 * so this generator and `build-from-fields.ts` stay in lockstep.
 */
function buildDrizzleColumnRecord(
  fields: FieldDefinition[],
  dialect: SupportedDialect,
  options: RuntimeSchemaOptions = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle requires dialect-specific column builder unions
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
  const out: Record<string, any> = {};

  const hasTitleField = fields.some(f => f.name === "title");
  const hasSlugField = fields.some(f => f.name === "slug");

  // System columns first (id, created_at, updated_at; conditionally title,
  // slug, and status). Source-of-truth descriptor list lives in
  // field-column-descriptor.ts and stays in lockstep with the diff input.
  for (const sys of getSystemColumnDescriptors(dialect, {
    hasTitleField,
    hasSlugField,
    hasStatus: options.status === true,
  })) {
    out[sys.name] = buildSystemDrizzleColumn(sys, dialect);
  }

  // User-defined fields. Layout-only field types and unmapped types
  // come back as `null` from getColumnDescriptor and are skipped.
  for (const field of fields) {
    const desc = getColumnDescriptor(field, dialect);
    if (!desc) continue;
    out[field.name] = buildUserDrizzleColumn(desc, dialect);
  }

  return out;
}

/**
 * Translates a system-column descriptor (id / title / slug /
 * created_at / updated_at) into the appropriate Drizzle column
 * builder for the given dialect. Mirrors the legacy hardcoded
 * builders byte-for-byte: id is primaryKey, title/slug are
 * notNull, timestamps default to defaultNow on PG/MySQL.
 */
function buildSystemDrizzleColumn(
  sys: ReturnType<typeof getSystemColumnDescriptors>[number],
  dialect: SupportedDialect
): unknown {
  if (dialect === "postgresql") {
    if (sys.name === "id") return pgText("id").primaryKey();
    if (sys.name === "created_at") return pgTimestamp("created_at").defaultNow();
    if (sys.name === "updated_at") return pgTimestamp("updated_at").defaultNow();
    if (sys.name === "status") {
      // Why: 'draft' default ensures backfill on enable doesn't accidentally
      // publish anything. Length 20 leaves headroom over "published" (9 chars).
      return pgVarchar("status", { length: 20 }).notNull().default("draft");
    }
    // title / slug — text NOT NULL.
    return pgText(sys.name).notNull();
  }
  if (dialect === "mysql") {
    if (sys.name === "id") {
      return mysqlVarchar("id", { length: 36 }).primaryKey();
    }
    if (sys.name === "created_at") {
      return mysqlTimestamp("created_at").defaultNow();
    }
    if (sys.name === "updated_at") {
      return mysqlTimestamp("updated_at").defaultNow();
    }
    if (sys.name === "status") {
      return mysqlVarchar("status", { length: 20 }).notNull().default("draft");
    }
    return mysqlVarchar(sys.name, { length: 255 }).notNull();
  }
  // sqlite
  if (sys.name === "id") return sqliteText("id").primaryKey();
  if (sys.name === "created_at") {
    return sqliteInteger("created_at", { mode: "timestamp" });
  }
  if (sys.name === "updated_at") {
    return sqliteInteger("updated_at", { mode: "timestamp" });
  }
  if (sys.name === "status") {
    // SQLite has no varchar — text with default 'draft' is the equivalent.
    return sqliteText("status").notNull().default("draft");
  }
  return sqliteText(sys.name).notNull();
}

/**
 * Translates a user-field descriptor into the appropriate Drizzle
 * column builder. The descriptor's `kind` is the dispatch key —
 * the per-dialect Drizzle imports stay isolated to this function.
 */
function buildUserDrizzleColumn(
  desc: ColumnDescriptor,
  dialect: SupportedDialect
): unknown {
  if (dialect === "postgresql") {
    return buildPgColumnFromKind(desc.kind, desc.name, desc.nullable);
  }
  if (dialect === "mysql") {
    return buildMysqlColumnFromKind(
      desc.kind,
      desc.name,
      desc.nullable,
      desc.length
    );
  }
  return buildSqliteColumnFromKind(desc.kind, desc.name, desc.nullable);
}

function buildPgColumnFromKind(
  kind: ColumnKind,
  name: string,
  nullable: boolean
): unknown {
  switch (kind) {
    case "text":
    case "longText":
    case "varchar":
      return nullable ? pgText(name) : pgText(name).notNull();
    case "boolean":
      return nullable ? pgBoolean(name) : pgBoolean(name).notNull();
    case "double":
      return nullable
        ? pgDoublePrecision(name)
        : pgDoublePrecision(name).notNull();
    case "timestamp":
      return nullable ? pgTimestamp(name) : pgTimestamp(name).notNull();
    case "json":
      return nullable ? pgJsonb(name) : pgJsonb(name).notNull();
    case "fkSingle":
      return pgText(name);
    case "skip":
      return null;
  }
}

function buildMysqlColumnFromKind(
  kind: ColumnKind,
  name: string,
  nullable: boolean,
  length: number | undefined
): unknown {
  switch (kind) {
    case "text":
    case "varchar": {
      const col = mysqlVarchar(name, { length: length ?? 255 });
      return nullable ? col : col.notNull();
    }
    case "longText":
      return nullable ? mysqlText(name) : mysqlText(name).notNull();
    case "boolean":
      return nullable ? mysqlBoolean(name) : mysqlBoolean(name).notNull();
    case "double":
      return nullable ? mysqlDouble(name) : mysqlDouble(name).notNull();
    case "timestamp":
      return nullable ? mysqlTimestamp(name) : mysqlTimestamp(name).notNull();
    case "json":
      return nullable ? mysqlJson(name) : mysqlJson(name).notNull();
    case "fkSingle":
      return mysqlVarchar(name, { length: length ?? 36 });
    case "skip":
      return null;
  }
}

function buildSqliteColumnFromKind(
  kind: ColumnKind,
  name: string,
  nullable: boolean
): unknown {
  switch (kind) {
    case "text":
    case "longText":
    case "varchar":
      return nullable ? sqliteText(name) : sqliteText(name).notNull();
    case "boolean":
      return nullable
        ? sqliteInteger(name, { mode: "boolean" })
        : sqliteInteger(name, { mode: "boolean" }).notNull();
    case "double":
      return nullable ? sqliteReal(name) : sqliteReal(name).notNull();
    case "timestamp":
      return nullable
        ? sqliteInteger(name, { mode: "timestamp" })
        : sqliteInteger(name, { mode: "timestamp" }).notNull();
    case "json":
      // SQLite stores JSON as text.
      return nullable ? sqliteText(name) : sqliteText(name).notNull();
    case "fkSingle":
      return sqliteText(name);
    case "skip":
      return null;
  }
}

// Phase 5 (2026-05-01): the legacy mapFieldToPostgresColumn /
// mapFieldToMySQLColumn / mapFieldToSQLiteColumn switches were removed.
// Their logic was duplicated against pipeline/diff/build-from-fields.ts
// and inevitably drifted (notably: hasMany / relationTo[] handling for
// relations). All per-field type mapping now flows through
// services/field-column-descriptor.ts, with the dialect-specific
// Drizzle column construction handled by the buildXxxColumnFromKind
// helpers above. Adding a new field type means updating one place.
