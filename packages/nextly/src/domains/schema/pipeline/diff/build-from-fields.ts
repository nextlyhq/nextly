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

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  getColumnDescriptor,
  getSystemColumnDescriptors,
  toSnakeCase,
} from "../../services/field-column-descriptor";

import { indexKey } from "./index-util";
import type { ColumnSpec, IndexSpec, TableSpec } from "./types";

/**
 * Drop indexes that duplicate an earlier one by logical key (same column set +
 * uniqueness). The system slug index and a user/injected `unique` slug field
 * both target `unique(slug)`; keep the first (system) and drop the redundant
 * one so migrations don't emit two indexes for the same constraint.
 */
function dedupeIndexes(indexes: IndexSpec[]): IndexSpec[] {
  const seen = new Set<string>();
  return indexes.filter(i => {
    const key = indexKey(i);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
  unique?: boolean;
  index?: boolean;
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

  // A field materializes a parent column unless the descriptor skips it (a
  // component field stores its data in its own table). Column-less fields must
  // not suppress the system title/slug column nor receive an index.
  const producesColumn = (f: (typeof fields)[number]): boolean =>
    getColumnDescriptor(
      f as unknown as Parameters<typeof getColumnDescriptor>[0],
      dialect
    ) !== null;

  // Inject reserved system columns first - mirrors runtime-schema-generator's
  // behavior. title/slug only when a column-producing user field replaces them
  // (user wins). status only when Draft/Published is enabled.
  const hasTitleField = fields.some(
    f => f.name === "title" && producesColumn(f)
  );
  const hasSlugField = fields.some(f => f.name === "slug" && producesColumn(f));
  for (const reserved of getSystemColumnDescriptors(dialect, {
    hasTitleField,
    hasSlugField,
    hasStatus: options.hasStatus,
  })) {
    columns.push({
      name: reserved.name,
      type: reserved.dialectType,
      nullable: reserved.nullable,
      // Forward descriptor default so the classifier doesn't flag status as
      // `add_required_field_no_default` and require TTY confirmation.
      default: reserved.default,
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

  // Indexes: system slug(unique)+created_at, plus per-field unique/index and a
  // single-relationship auto-index (matches the runtime live-DDL). hasMany /
  // polymorphic relationships are JSON columns and get NO index.
  const indexes: IndexSpec[] = [];
  if (columns.some(c => c.name === "slug")) {
    indexes.push({
      name: `idx_${tableName}_slug`,
      columns: ["slug"],
      unique: true,
    });
  }
  if (columns.some(c => c.name === "created_at")) {
    indexes.push({
      name: `idx_${tableName}_created_at`,
      columns: ["created_at"],
      unique: false,
    });
  }
  for (const field of fields) {
    const col = toSnakeCase(field.name);
    // Skip fields that materialize no column (e.g. component fields): a unique
    // or plain index on a nonexistent column is invalid DDL. Check the field
    // directly (not column presence) so a component named after a system column
    // like `title` does not index the system-injected column instead.
    if (!producesColumn(field)) continue;
    const isSingleRelation =
      (field.type === "relationship" || field.type === "upload") &&
      field.hasMany !== true &&
      !Array.isArray(field.relationTo);
    if (field.unique === true) {
      indexes.push({
        name: `uq_${tableName}_${col}`,
        columns: [col],
        unique: true,
      });
    } else if (field.index === true || isSingleRelation) {
      indexes.push({
        name: `idx_${tableName}_${col}`,
        columns: [col],
        unique: false,
      });
    }
  }
  return { name: tableName, columns, indexes: dedupeIndexes(indexes) };
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
    columns.push({
      name: "id",
      type: "text",
      nullable: false,
      default: undefined,
    });
    columns.push({
      name: "_parent_id",
      type: "text",
      nullable: false,
      default: undefined,
    });
    columns.push({
      name: "_parent_table",
      type: "varchar",
      nullable: false,
      default: undefined,
    });
    columns.push({
      name: "_parent_field",
      type: "varchar",
      nullable: false,
      default: undefined,
    });
    columns.push({
      name: "_order",
      type: "int4",
      nullable: true,
      default: undefined,
    });
    columns.push({
      name: "_component_type",
      type: "varchar",
      nullable: true,
      default: undefined,
    });
  } else if (dialect === "mysql") {
    columns.push({
      name: "id",
      type: "varchar(36)",
      nullable: false,
      default: undefined,
    });
    columns.push({
      name: "_parent_id",
      type: "varchar(36)",
      nullable: false,
      default: undefined,
    });
    columns.push({
      name: "_parent_table",
      type: "varchar(255)",
      nullable: false,
      default: undefined,
    });
    columns.push({
      name: "_parent_field",
      type: "varchar(255)",
      nullable: false,
      default: undefined,
    });
    columns.push({
      name: "_order",
      type: "int(11)",
      nullable: true,
      default: undefined,
    });
    columns.push({
      name: "_component_type",
      type: "varchar(255)",
      nullable: true,
      default: undefined,
    });
  } else {
    // sqlite
    columns.push({
      name: "id",
      type: "text",
      nullable: false,
      default: undefined,
    });
    columns.push({
      name: "_parent_id",
      type: "text",
      nullable: false,
      default: undefined,
    });
    columns.push({
      name: "_parent_table",
      type: "text",
      nullable: false,
      default: undefined,
    });
    columns.push({
      name: "_parent_field",
      type: "text",
      nullable: false,
      default: undefined,
    });
    columns.push({
      name: "_order",
      type: "integer",
      nullable: true,
      default: undefined,
    });
    columns.push({
      name: "_component_type",
      type: "text",
      nullable: true,
      default: undefined,
    });
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
  // timestamp({ withTimezone: false }) (pg → "timestamp"), DATETIME (mysql), INTEGER (sqlite).
  if (dialect === "postgresql") {
    columns.push({
      name: "created_at",
      type: "timestamp",
      nullable: false,
      default: undefined,
    });
    columns.push({
      name: "updated_at",
      type: "timestamp",
      nullable: false,
      default: undefined,
    });
  } else if (dialect === "mysql") {
    columns.push({
      name: "created_at",
      type: "datetime",
      nullable: false,
      default: undefined,
    });
    columns.push({
      name: "updated_at",
      type: "datetime",
      nullable: false,
      default: undefined,
    });
  } else {
    columns.push({
      name: "created_at",
      type: "integer",
      nullable: false,
      default: undefined,
    });
    columns.push({
      name: "updated_at",
      type: "integer",
      nullable: false,
      default: undefined,
    });
  }

  // Component tables have no slug. They get a composite index on the parent-link
  // columns plus the system created_at index — mirroring component-schema-service.ts
  // (idx_<table>_parent). The parent index is required so the migrate:create snapshot
  // matches the table the apply pipeline builds; otherwise the live index reads as an
  // unmanaged extra and `migrate:resolve --applied` verify emits a spurious drop_index.
  const indexes: IndexSpec[] = [
    {
      name: `idx_${tableName}_parent`,
      columns: ["_parent_id", "_parent_table", "_parent_field"],
      unique: false,
    },
  ];
  if (columns.some(c => c.name === "created_at")) {
    indexes.push({
      name: `idx_${tableName}_created_at`,
      columns: ["created_at"],
      unique: false,
    });
  }
  return { name: tableName, columns, indexes: dedupeIndexes(indexes) };
}
