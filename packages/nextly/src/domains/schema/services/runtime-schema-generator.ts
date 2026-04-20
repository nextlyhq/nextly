/**
 * Runtime Schema Generator
 *
 * Generates Drizzle ORM table schemas at runtime from field definitions.
 * This is used for UI-created collections that don't have pre-compiled TypeScript schemas.
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
} from "drizzle-orm/pg-core";
import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
  real as sqliteReal,
} from "drizzle-orm/sqlite-core";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";

export type SupportedDialect = "postgresql" | "mysql" | "sqlite";

// Return type for generateRuntimeSchema - provides the Drizzle table object
// and a schemaRecord keyed by table name for pushSchema() consumption.
export interface RuntimeSchemaResult {
  table: unknown; // PgTable | MySqlTable | SqliteTable
  schemaRecord: Record<string, unknown>; // { [tableName]: table } for pushSchema()
}

// Layout-only field types that don't create database columns
const LAYOUT_FIELD_TYPES = new Set(["tabs", "collapsible", "row"]);

/**
 * Convert a camelCase field name to snake_case for database column names.
 * Matches the conversion used in schema-generator.ts.
 */
function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

/**
 * Generate a Drizzle table schema at runtime from field definitions.
 *
 * @param tableName - The database table name (should include dc_ prefix)
 * @param fields - Array of field definitions from the collection
 * @param dialect - Database dialect (postgresql, mysql, sqlite)
 * @returns RuntimeSchemaResult with table object and schemaRecord for pushSchema()
 */
export function generateRuntimeSchema(
  tableName: string,
  fields: FieldDefinition[],
  dialect: SupportedDialect
): RuntimeSchemaResult {
  let table: unknown;
  switch (dialect) {
    case "postgresql":
      table = generatePostgresSchema(tableName, fields);
      break;
    case "mysql":
      table = generateMySQLSchema(tableName, fields);
      break;
    case "sqlite":
      table = generateSQLiteSchema(tableName, fields);
      break;
    default:
      throw new Error(`Unsupported dialect: ${dialect}`);
  }
  return {
    table,
    schemaRecord: { [tableName]: table },
  };
}

function generatePostgresSchema(
  tableName: string,
  fields: FieldDefinition[]
): unknown {
  // Check if fields define their own reserved columns (to avoid duplicates)
  const hasSlugField = fields.some(f => f.name === "slug");
  const hasTitleField = fields.some(f => f.name === "title");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle ORM requires dialect-specific column builders
  const columns: Record<string, any> = {
    // Standard columns that SchemaPushService always creates
    id: pgText("id").primaryKey(),
    // Title column added unless explicitly defined in fields
    ...(hasTitleField ? {} : { title: pgText("title").notNull() }),
    // Slug column added only if not defined as a collection field
    ...(hasSlugField ? {} : { slug: pgText("slug").notNull() }),
    created_at: pgTimestamp("created_at").defaultNow(),
    updated_at: pgTimestamp("updated_at").defaultNow(),
  };

  // Add columns for each field
  for (const field of fields) {
    const columnName = field.name;
    const column = mapFieldToPostgresColumn(field);
    if (column) {
      columns[columnName] = column;
    }
  }

  return pgTable(tableName, columns);
}

function generateMySQLSchema(
  tableName: string,
  fields: FieldDefinition[]
): unknown {
  const hasSlugField = fields.some(f => f.name === "slug");
  const hasTitleField = fields.some(f => f.name === "title");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle ORM requires dialect-specific column builders
  const columns: Record<string, any> = {
    // Standard columns that SchemaPushService always creates
    id: mysqlVarchar("id", { length: 36 }).primaryKey(),
    // Title column added unless explicitly defined in fields
    ...(hasTitleField
      ? {}
      : { title: mysqlVarchar("title", { length: 255 }).notNull() }),
    ...(hasSlugField
      ? {}
      : { slug: mysqlVarchar("slug", { length: 255 }).notNull() }),
    created_at: mysqlTimestamp("created_at").defaultNow(),
    updated_at: mysqlTimestamp("updated_at").defaultNow(),
  };

  // Add columns for each field
  for (const field of fields) {
    const columnName = field.name;
    const column = mapFieldToMySQLColumn(field);
    if (column) {
      columns[columnName] = column;
    }
  }

  return mysqlTable(tableName, columns);
}

function generateSQLiteSchema(
  tableName: string,
  fields: FieldDefinition[]
): unknown {
  const hasSlugField = fields.some(f => f.name === "slug");
  const hasTitleField = fields.some(f => f.name === "title");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle ORM requires dialect-specific column builders
  const columns: Record<string, any> = {
    // Standard columns that SchemaPushService always creates
    id: sqliteText("id").primaryKey(),
    // Title column added unless explicitly defined in fields
    ...(hasTitleField ? {} : { title: sqliteText("title").notNull() }),
    ...(hasSlugField ? {} : { slug: sqliteText("slug").notNull() }),
    created_at: sqliteInteger("created_at", { mode: "timestamp" }),
    updated_at: sqliteInteger("updated_at", { mode: "timestamp" }),
  };

  // Add columns for each field
  for (const field of fields) {
    const columnName = field.name;
    const column = mapFieldToSQLiteColumn(field);
    if (column) {
      columns[columnName] = column;
    }
  }

  return sqliteTable(tableName, columns);
}

function mapFieldToPostgresColumn(field: FieldDefinition): unknown {
  // Layout-only fields don't create database columns
  if (LAYOUT_FIELD_TYPES.has(field.type)) return null;

  const isRequired = field.required === true;
  const colName = toSnakeCase(field.name);

  switch (field.type) {
    case "text":
    case "string": // Legacy alias for text
    case "email":
    case "password":
    case "slug":
      return isRequired ? pgText(colName).notNull() : pgText(colName);

    case "textarea":
    case "richText":
    case "richtext": // Legacy alias
    case "code":
      return isRequired ? pgText(colName).notNull() : pgText(colName);

    case "number":
    case "decimal": // Legacy alias for number
      return isRequired
        ? pgDoublePrecision(colName).notNull()
        : pgDoublePrecision(colName);

    case "checkbox":
    case "boolean": // Legacy alias for checkbox
      return isRequired ? pgBoolean(colName).notNull() : pgBoolean(colName);

    case "date":
      return isRequired ? pgTimestamp(colName).notNull() : pgTimestamp(colName);

    case "select":
    case "radio":
      return isRequired ? pgText(colName).notNull() : pgText(colName);

    case "relationship":
    case "relation": // Legacy alias
    case "upload": {
      const hasMany = (field as { hasMany?: boolean }).hasMany;
      const relationTo = (field as { relationTo?: unknown }).relationTo;
      if (hasMany || Array.isArray(relationTo)) {
        return isRequired ? pgJsonb(colName).notNull() : pgJsonb(colName);
      }
      return pgText(colName);
    }

    case "repeater":
    case "group":
    case "blocks":
    case "component":
    case "json":
    case "chips":
      return isRequired ? pgJsonb(colName).notNull() : pgJsonb(colName);

    case "point":
      // Geolocation stored as JSON { lat, lng }
      return pgJsonb(colName);

    default:
      // Default to text for unknown types
      return pgText(colName);
  }
}

function mapFieldToMySQLColumn(field: FieldDefinition): unknown {
  // Layout-only fields don't create database columns
  if (LAYOUT_FIELD_TYPES.has(field.type)) return null;

  const isRequired = field.required === true;
  const colName = toSnakeCase(field.name);

  switch (field.type) {
    case "text":
    case "string":
    case "email":
    case "password":
    case "slug":
      return isRequired
        ? mysqlVarchar(colName, { length: 255 }).notNull()
        : mysqlVarchar(colName, { length: 255 });

    case "textarea":
    case "richText":
    case "richtext":
    case "code":
      return isRequired ? mysqlText(colName).notNull() : mysqlText(colName);

    case "number":
    case "decimal":
      return isRequired ? mysqlDouble(colName).notNull() : mysqlDouble(colName);

    case "checkbox":
    case "boolean":
      return isRequired
        ? mysqlBoolean(colName).notNull()
        : mysqlBoolean(colName);

    case "date":
      return isRequired
        ? mysqlTimestamp(colName).notNull()
        : mysqlTimestamp(colName);

    case "select":
    case "radio":
      return isRequired
        ? mysqlVarchar(colName, { length: 255 }).notNull()
        : mysqlVarchar(colName, { length: 255 });

    case "relationship":
    case "relation":
    case "upload": {
      const hasMany = (field as { hasMany?: boolean }).hasMany;
      const relationTo = (field as { relationTo?: unknown }).relationTo;
      if (hasMany || Array.isArray(relationTo)) {
        return isRequired ? mysqlJson(colName).notNull() : mysqlJson(colName);
      }
      return mysqlVarchar(colName, { length: 36 });
    }

    case "repeater":
    case "group":
    case "blocks":
    case "component":
    case "json":
    case "chips":
      return isRequired ? mysqlJson(colName).notNull() : mysqlJson(colName);

    case "point":
      return mysqlJson(colName);

    default:
      return mysqlVarchar(colName, { length: 255 });
  }
}

function mapFieldToSQLiteColumn(field: FieldDefinition): unknown {
  // Layout-only fields don't create database columns
  if (LAYOUT_FIELD_TYPES.has(field.type)) return null;

  const isRequired = field.required === true;
  const colName = toSnakeCase(field.name);

  switch (field.type) {
    case "text":
    case "string":
    case "email":
    case "password":
    case "slug":
    case "textarea":
    case "richText":
    case "richtext":
    case "code":
    case "select":
    case "radio":
      return isRequired ? sqliteText(colName).notNull() : sqliteText(colName);

    case "number":
    case "decimal":
      return isRequired ? sqliteReal(colName).notNull() : sqliteReal(colName);

    case "checkbox":
    case "boolean":
      return isRequired
        ? sqliteInteger(colName, { mode: "boolean" }).notNull()
        : sqliteInteger(colName, { mode: "boolean" });

    case "date":
      return isRequired
        ? sqliteInteger(colName, { mode: "timestamp" }).notNull()
        : sqliteInteger(colName, { mode: "timestamp" });

    case "relationship":
    case "relation":
    case "upload":
      return sqliteText(colName);

    case "repeater":
    case "group":
    case "blocks":
    case "component":
    case "json":
    case "chips":
    case "point":
      // SQLite stores structured data as text (JSON)
      return isRequired ? sqliteText(colName).notNull() : sqliteText(colName);

    default:
      return sqliteText(colName);
  }
}
