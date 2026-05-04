// Builds a TableSpec from a Nextly FieldConfig[] (the format dynamic_collections
// stores + the format the dispatcher receives). This is the "desired state"
// input to our diff engine.
//
// Phase 5 (2026-05-01): the type-mapping logic that used to live here was
// duplicated against `runtime-schema-generator.ts`, with predictable drift.
// Both now delegate to `services/field-column-descriptor.ts` for the
// per-dialect token rendering. Adding a field type means updating one
// place; the diff engine and the runtime Drizzle builder stay in lockstep.
//
// Type-token alignment with introspection:
// The diff compares this output against the live-DB introspection output.
// The descriptor module renders introspection-aligned tokens:
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
// Both paths now read the system-column set from the descriptor module.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import {
  getColumnDescriptor,
  getSystemColumnDescriptors,
} from "../../services/field-column-descriptor";

import type { ColumnSpec, TableSpec } from "./types";

// Minimal field shape we read. The real FieldDefinition type has many more
// attributes; we only need name + type + required + hasMany + relationTo for
// diff purposes (the descriptor module pulls hasMany/relationTo via attribute
// access, so structurally-typed input works as long as those keys exist).
interface MinimalFieldDef {
  name: string;
  type: string;
  required?: boolean;
  hasMany?: boolean;
  relationTo?: unknown;
}

/** Optional toggles that affect which system columns are injected. */
export interface BuildDesiredTableOptions {
  /** When true, a `status` system column is injected (varchar/text NOT NULL DEFAULT 'draft'). */
  hasStatus?: boolean;
}

/**
 * Build a TableSpec for the diff engine from a list of Nextly fields.
 * Field type tokens are translated to introspection-aligned strings via
 * the shared descriptor module so the diff can compare them directly
 * against live-DB output. Reserved system columns (id, title, slug,
 * created_at, updated_at, and conditionally status) are injected to match
 * runtime-schema-generator's behavior — the descriptor module owns that list.
 */
export function buildDesiredTableFromFields(
  tableName: string,
  fields: MinimalFieldDef[],
  dialect: SupportedDialect,
  options: BuildDesiredTableOptions = {}
): TableSpec {
  const columns: ColumnSpec[] = [];

  // Inject reserved system columns first - mirrors runtime-schema-generator's
  // behavior. title/slug only when not user-defined (user wins). status only
  // when the collection/single has Draft/Published enabled.
  const hasTitleField = fields.some(f => f.name === "title");
  const hasSlugField = fields.some(f => f.name === "slug");
  for (const reserved of getSystemColumnDescriptors(dialect, {
    hasTitleField,
    hasSlugField,
    hasStatus: options.hasStatus,
  })) {
    columns.push({
      name: reserved.name,
      type: reserved.dialectType,
      nullable: reserved.nullable,
      default: undefined,
    });
  }

  // User-defined fields — descriptor module handles layout-only filtering,
  // hasMany/relationTo promotion to JSON, and per-dialect token rendering.
  for (const field of fields) {
    const desc = getColumnDescriptor(
      // The descriptor's input type is FieldDefinition; this util is
      // structurally compatible (same name/type/required/hasMany/relationTo
      // keys). Cast through unknown to bridge the two surface types
      // without leaking either back through the module graph.
      field as unknown as Parameters<typeof getColumnDescriptor>[0],
      dialect
    );
    if (!desc) continue;
    columns.push({
      name: desc.name,
      type: desc.dialectType,
      nullable: desc.nullable,
      default: undefined,
    });
  }
  return { name: tableName, columns };
}

/**
 * Build a TableSpec for the diff engine from a component's user fields.
 * Injects component system columns (_parent_id, _parent_table, _parent_field,
 * _order, _component_type) instead of collection system columns (title, slug).
 * Used by previewDesiredSchema when processing desired.components.
 */
export function buildDesiredTableFromComponentFields(
  tableName: string,
  fields: MinimalFieldDef[],
  dialect: SupportedDialect
): TableSpec {
  const columns: ColumnSpec[] = [];

  // Component system columns — mirrors component-schema-service.ts DDL.
  if (dialect === "postgresql") {
    columns.push({ name: "id", type: "text", nullable: false, default: undefined });
    columns.push({ name: "_parent_id", type: "text", nullable: false, default: undefined });
    columns.push({ name: "_parent_table", type: "varchar", nullable: false, default: undefined });
    columns.push({ name: "_parent_field", type: "varchar", nullable: false, default: undefined });
    columns.push({ name: "_order", type: "int4", nullable: true, default: undefined });
    columns.push({ name: "_component_type", type: "varchar", nullable: true, default: undefined });
  } else if (dialect === "mysql") {
    columns.push({ name: "id", type: "varchar(36)", nullable: false, default: undefined });
    columns.push({ name: "_parent_id", type: "varchar(36)", nullable: false, default: undefined });
    columns.push({ name: "_parent_table", type: "varchar(255)", nullable: false, default: undefined });
    columns.push({ name: "_parent_field", type: "varchar(255)", nullable: false, default: undefined });
    columns.push({ name: "_order", type: "int(11)", nullable: true, default: undefined });
    columns.push({ name: "_component_type", type: "varchar(255)", nullable: true, default: undefined });
  } else {
    // sqlite
    columns.push({ name: "id", type: "text", nullable: false, default: undefined });
    columns.push({ name: "_parent_id", type: "text", nullable: false, default: undefined });
    columns.push({ name: "_parent_table", type: "text", nullable: false, default: undefined });
    columns.push({ name: "_parent_field", type: "text", nullable: false, default: undefined });
    columns.push({ name: "_order", type: "integer", nullable: true, default: undefined });
    columns.push({ name: "_component_type", type: "text", nullable: true, default: undefined });
  }

  // User-defined fields.
  for (const field of fields) {
    const desc = getColumnDescriptor(
      field as unknown as Parameters<typeof getColumnDescriptor>[0],
      dialect
    );
    if (!desc) continue;
    columns.push({
      name: desc.name,
      type: desc.dialectType,
      nullable: desc.nullable,
      default: undefined,
    });
  }

  // Timestamp columns — type tokens must match PostgreSQL udt_name / MySQL
  // COLUMN_TYPE as returned by introspection. Component DDL uses
  // TIMESTAMP WITH TIME ZONE (pg → "timestamptz"), DATETIME (mysql), INTEGER (sqlite).
  if (dialect === "postgresql") {
    columns.push({ name: "created_at", type: "timestamptz", nullable: false, default: undefined });
    columns.push({ name: "updated_at", type: "timestamptz", nullable: false, default: undefined });
  } else if (dialect === "mysql") {
    columns.push({ name: "created_at", type: "datetime", nullable: false, default: undefined });
    columns.push({ name: "updated_at", type: "datetime", nullable: false, default: undefined });
  } else {
    columns.push({ name: "created_at", type: "integer", nullable: false, default: undefined });
    columns.push({ name: "updated_at", type: "integer", nullable: false, default: undefined });
  }

  return { name: tableName, columns };
}
