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
//   SQLite PRAGMA type - declared type as written. drizzle-orm/sqlite-core emits
//                        LOWERCASE types ("text", "integer", "real"), so PRAGMA
//                        returns lowercase. We emit lowercase tokens to match.
//
// Reserved columns: runtime-schema-generator.ts always injects id + created_at
// + updated_at, plus title/slug unless the user defined fields by those names.
// We mirror that injection here so the diff doesn't see them as drops.
//
// See runtime-schema-generator.ts for the runtime Drizzle table builder
// that produces actual DDL. This helper produces a parallel representation
// for diffing, NOT the actual Drizzle column objects.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import type { ColumnSpec, TableSpec } from "./types";

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
 * the diff can compare them directly against live-DB output. Reserved
 * system columns (id, title, slug, created_at, updated_at) are injected
 * to match runtime-schema-generator's behavior.
 */
export function buildDesiredTableFromFields(
  tableName: string,
  fields: MinimalFieldDef[],
  dialect: SupportedDialect
): TableSpec {
  const columns: ColumnSpec[] = [];

  // Inject reserved system columns first - mirrors runtime-schema-generator's
  // behavior. title/slug only when not user-defined (user wins).
  const hasTitleField = fields.some(f => f.name === "title");
  const hasSlugField = fields.some(f => f.name === "slug");
  for (const reserved of buildReservedColumns(dialect, {
    includeTitle: !hasTitleField,
    includeSlug: !hasSlugField,
  })) {
    columns.push(reserved);
  }

  // User-defined fields.
  for (const field of fields) {
    if (LAYOUT_FIELD_TYPES.has(field.type)) continue;
    const col = mapFieldToColumnSpec(field, dialect);
    if (col) columns.push(col);
  }
  return { name: tableName, columns };
}

// Reserved columns runtime-schema-generator always (or conditionally) injects.
// Token alignment with introspection per dialect:
//   PG: pgText("id").primaryKey()              -> udt_name "text", NOT NULL
//       pgTimestamp("created_at").defaultNow() -> udt_name "timestamp"
//   MySQL: mysqlVarchar("id", {length: 36})    -> COLUMN_TYPE "varchar(36)"
//          mysqlVarchar("title", {length:255}) -> "varchar(255)"
//          mysqlTimestamp("created_at")        -> "timestamp"
//   SQLite: sqliteText("id")                   -> PRAGMA "text"
//           sqliteInteger("created_at",
//                         {mode: "timestamp"}) -> PRAGMA "integer"
//
// notNull / defaultNow / primaryKey on the runtime side are not yet read
// here; F4 Option E PR 3 (default-value comparator) refines this. For PR 1
// we set nullable based on what runtime-schema-generator declares (id =
// NOT NULL primary key; title/slug = NOT NULL when not user-defined;
// created_at/updated_at left nullable since defaultNow handles inserts).
function buildReservedColumns(
  dialect: SupportedDialect,
  opts: { includeTitle: boolean; includeSlug: boolean }
): ColumnSpec[] {
  const out: ColumnSpec[] = [];
  if (dialect === "postgresql") {
    out.push({ name: "id", type: "text", nullable: false });
    if (opts.includeTitle) {
      out.push({ name: "title", type: "text", nullable: false });
    }
    if (opts.includeSlug) {
      out.push({ name: "slug", type: "text", nullable: false });
    }
    out.push({ name: "created_at", type: "timestamp", nullable: true });
    out.push({ name: "updated_at", type: "timestamp", nullable: true });
    return out;
  }
  if (dialect === "mysql") {
    out.push({ name: "id", type: "varchar(36)", nullable: false });
    if (opts.includeTitle) {
      out.push({ name: "title", type: "varchar(255)", nullable: false });
    }
    if (opts.includeSlug) {
      out.push({ name: "slug", type: "varchar(255)", nullable: false });
    }
    out.push({ name: "created_at", type: "timestamp", nullable: true });
    out.push({ name: "updated_at", type: "timestamp", nullable: true });
    return out;
  }
  // SQLite - lowercase tokens to match drizzle's emitted DDL + PRAGMA output.
  out.push({ name: "id", type: "text", nullable: false });
  if (opts.includeTitle) {
    out.push({ name: "title", type: "text", nullable: false });
  }
  if (opts.includeSlug) {
    out.push({ name: "slug", type: "text", nullable: false });
  }
  out.push({ name: "created_at", type: "integer", nullable: true });
  out.push({ name: "updated_at", type: "integer", nullable: true });
  return out;
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
      // runtime-schema-generator uses varchar(36) for FK-to-UUID-id
      // (mysqlVarchar("rel", { length: 36 })). Match that exactly.
      return "varchar(36)";
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

// SQLite PRAGMA type tokens. drizzle-orm/sqlite-core emits LOWERCASE types
// in its CREATE TABLE DDL ("text", "integer", "real"). PRAGMA returns the
// type as-declared, so we must emit lowercase here to match. Earlier
// uppercase tokens caused false-positive change_column_type ops on every
// diff cycle (caught by F4 Option E PR 1 code review).
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
      return "text";
    case "number":
    case "decimal":
      return "real";
    case "checkbox":
    case "boolean":
      return "integer"; // SQLite stores booleans as integers (0/1)
    case "date":
      return "integer"; // Stored as epoch ms
    case "relationship":
    case "relation":
    case "upload":
      return "text";
    case "repeater":
    case "group":
    case "blocks":
    case "component":
    case "json":
    case "chips":
      return "text"; // SQLite stores JSON as text
    case "point":
      return "text";
    default:
      return "text";
  }
}
