// Builds a TableSpec from a Nextly FieldConfig[] (the format dynamic_collections
// stores + the format the dispatcher receives). This is the "desired state"
// input to our diff engine.
//
// Type-token alignment with introspection:
// The diff compares this output against the live-DB introspection output.
// To enable equality comparison, type tokens here must match what
// information_schema.columns / PRAGMA returns:
//
//   PG udt_name   - "text", "varchar", "bool", "float8", "timestamp", "jsonb",
//                   "uuid", "bytea", "int4", "int8" (note: udt_name returns
//                   abbreviated forms, not the SQL standard names)
//   MySQL COLUMN_TYPE - full declared type as written: "varchar(255)", "int(11)",
//                       "tinyint(1)", "double", "json", "text"
//   SQLite PRAGMA type - declared type as written: "TEXT", "INTEGER", "REAL", "BLOB"
//
// For diffing we don't need EXACT introspection match - the F4 type-family
// comparison gives compatibility checks. But matching the introspection
// format reduces false-positive change_column_type ops.
//
// See runtime-schema-generator.ts for the runtime Drizzle table builder
// that produces actual DDL. This helper produces a parallel representation
// for diffing, NOT the actual Drizzle column objects.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import type { ColumnSpec, TableSpec } from "./types.js";

// Layout-only field types don't create database columns. Mirrors the
// LAYOUT_FIELD_TYPES set in runtime-schema-generator.ts.
const LAYOUT_FIELD_TYPES = new Set(["tabs", "collapsible", "row"]);

// Minimal field shape we read. The real FieldDefinition type has many more
// attributes; we only need name + type + required for diff purposes.
interface MinimalFieldDef {
  name: string;
  type: string;
  required?: boolean;
}

/**
 * Build a TableSpec for the diff engine from a list of Nextly fields.
 * Field type tokens are translated to introspection-aligned strings so
 * the diff can compare them directly against live-DB output.
 */
export function buildDesiredTableFromFields(
  tableName: string,
  fields: MinimalFieldDef[],
  dialect: SupportedDialect
): TableSpec {
  const columns: ColumnSpec[] = [];
  for (const field of fields) {
    if (LAYOUT_FIELD_TYPES.has(field.type)) continue;
    const col = mapFieldToColumnSpec(field, dialect);
    if (col) columns.push(col);
  }
  return { name: tableName, columns };
}

function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

function mapFieldToColumnSpec(
  field: MinimalFieldDef,
  dialect: SupportedDialect
): ColumnSpec | null {
  const name = toSnakeCase(field.name);
  const nullable = field.required !== true;
  const type = mapFieldTypeToken(field.type, dialect);
  if (type === null) return null;
  return { name, type, nullable, default: undefined };
}

// Returns the per-dialect type token that introspection would return for
// this field type. Returns null for unmapped (layout-only) types.
function mapFieldTypeToken(
  fieldType: string,
  dialect: SupportedDialect
): string | null {
  if (dialect === "postgresql") {
    return mapToPgToken(fieldType);
  }
  if (dialect === "mysql") {
    return mapToMysqlToken(fieldType);
  }
  return mapToSqliteToken(fieldType);
}

// PG udt_name tokens. Mirrors runtime-schema-generator's mapFieldToPostgresColumn.
function mapToPgToken(fieldType: string): string | null {
  switch (fieldType) {
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
      return "text";
    case "number":
    case "decimal":
      return "float8";
    case "checkbox":
    case "boolean":
      return "bool";
    case "date":
      return "timestamp";
    case "relationship":
    case "relation":
    case "upload":
      // Single-target relations -> text (FK as string id). Many-target
      // (hasMany) -> jsonb. We can't determine that from MinimalFieldDef
      // alone, so default to text. Diff will mark a change if the runtime
      // generates jsonb. Out of scope to handle perfectly in v1.
      return "text";
    case "repeater":
    case "group":
    case "blocks":
    case "component":
    case "json":
    case "chips":
      return "jsonb";
    case "point":
      return "jsonb";
    default:
      return "text"; // Default fallback matches the runtime generator.
  }
}

// MySQL COLUMN_TYPE tokens.
function mapToMysqlToken(fieldType: string): string | null {
  switch (fieldType) {
    case "text":
    case "string":
    case "email":
    case "password":
    case "slug":
    case "select":
    case "radio":
      return "varchar(255)";
    case "textarea":
    case "richText":
    case "richtext":
    case "code":
      return "text";
    case "number":
    case "decimal":
      return "double";
    case "checkbox":
    case "boolean":
      return "tinyint(1)"; // MySQL boolean alias
    case "date":
      return "timestamp";
    case "relationship":
    case "relation":
    case "upload":
      return "varchar(255)";
    case "repeater":
    case "group":
    case "blocks":
    case "component":
    case "json":
    case "chips":
      return "json";
    case "point":
      return "json";
    default:
      return "varchar(255)";
  }
}

// SQLite PRAGMA type tokens (declared type, uppercase by convention).
function mapToSqliteToken(fieldType: string): string | null {
  switch (fieldType) {
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
      return "TEXT";
    case "number":
    case "decimal":
      return "REAL";
    case "checkbox":
    case "boolean":
      return "INTEGER"; // SQLite stores booleans as integers (0/1)
    case "date":
      return "INTEGER"; // Stored as epoch ms
    case "relationship":
    case "relation":
    case "upload":
      return "TEXT";
    case "repeater":
    case "group":
    case "blocks":
    case "component":
    case "json":
    case "chips":
      return "TEXT"; // SQLite stores JSON as text
    case "point":
      return "TEXT";
    default:
      return "TEXT";
  }
}
