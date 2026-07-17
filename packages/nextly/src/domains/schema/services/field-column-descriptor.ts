/**
 * Phase 5 (2026-05-01) — single source of truth for "given a Nextly
 * field config + dialect, what's the database column shape?"
 *
 * Why this module exists: pre-Phase-5 the same mapping logic was
 * duplicated across two files —
 *   - `runtime-schema-generator.ts`: turns a field config into a
 *     Drizzle ORM column builder (used at runtime to construct
 *     dynamic tables for pushSchema / queries).
 *   - `pipeline/diff/build-from-fields.ts`: turns a field config
 *     into a `ColumnSpec` (used by the diff engine to compare
 *     desired vs. live).
 *
 * The two switches inevitably drifted apart — adding a field type
 * to one without updating the other, or treating `hasMany` /
 * `relationTo` arrays differently between the two paths. Result:
 * the diff engine reported "56 false positives" on a stable
 * schema because its description of `desired` didn't match the
 * runtime's description.
 *
 * This module owns the per-dialect mapping. Both consumers call
 * `getColumnDescriptor(field, dialect)` and translate the
 * descriptor into their respective output formats — Drizzle column
 * builder for one, ColumnSpec for the other. Adding a new field
 * type now requires updating one place; the two consumers stay in
 * lockstep automatically.
 */

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { getFieldType } from "../field-types/field-type-registry";

export type SupportedDialect = "postgresql" | "mysql" | "sqlite";

/** Author-facing storage primitive (PluginFieldType.storage) → logical ColumnKind. */
const STORAGE_TO_COLUMN_KIND: Record<string, ColumnKind> = {
  text: "text",
  longText: "longText",
  boolean: "boolean",
  number: "integer",
  timestamp: "timestamp",
  json: "json",
};

/**
 * Database column descriptor — the intermediate representation used
 * to bridge field configs and downstream consumers.
 *
 * - `name`: the snake_case database column name (already converted
 *   from the field's camelCase).
 * - `type`: a logical type token. The `dialectType` field carries
 *   the introspection-aligned per-dialect token used by the diff
 *   engine (e.g., "text", "varchar(255)", "jsonb"). Both are
 *   produced together because they're trivially derivable.
 * - `dialectType`: the per-dialect string that introspection
 *   (information_schema.columns / PRAGMA / DESCRIBE) returns. The
 *   diff engine compares against this directly.
 * - `length`: for varchar/varbinary types, the declared length.
 * - `nullable`: true if the column allows NULL.
 * - `kind`: which Drizzle builder family this maps to. Lets the
 *   runtime generator pick the right column constructor without
 *   duplicating the type-switch.
 */
export interface ColumnDescriptor {
  name: string;
  dialectType: string;
  length?: number;
  /** Total digits for the `decimal` kind (DECIMAL/NUMERIC precision). */
  precision?: number;
  /** Fractional digits for the `decimal` kind (DECIMAL/NUMERIC scale). */
  scale?: number;
  nullable: boolean;
  kind: ColumnKind;
}

/** Default DECIMAL(precision, scale) when a decimal number field omits them. */
export const DEFAULT_DECIMAL_PRECISION = 10;
export const DEFAULT_DECIMAL_SCALE = 2;

/**
 * Logical column kind — used by `runtime-schema-generator.ts` to
 * pick the correct dialect-specific Drizzle column builder.
 *
 * Why a logical kind instead of "give me the Drizzle column
 * directly": the descriptor is dialect-agnostic-ish, and runtime
 * code needs typed dialect imports anyway. A small switch on `kind`
 * stays tiny and keeps Drizzle imports out of this module.
 */
export type ColumnKind =
  | "text" // PG: text, MySQL: varchar(255), SQLite: text
  | "longText" // PG: text, MySQL: text, SQLite: text — for textarea/richtext
  | "varchar" // varchar(N) explicitly (uses `length`)
  | "boolean" // PG: bool, MySQL: tinyint(1), SQLite: integer(boolean mode)
  | "integer" // PG: int4, MySQL: int, SQLite: integer
  | "double" // PG: float8, MySQL: double, SQLite: real
  | "decimal" // exact DECIMAL/NUMERIC(precision, scale); PG/SQLite: numeric, MySQL: decimal
  | "timestamp" // PG/MySQL: timestamp, SQLite: integer(timestamp mode)
  | "json" // PG: jsonb, MySQL: json, SQLite: text
  | "fkSingle" // single-target foreign key — text/varchar(36)
  | "skip"; // layout-only field types — no column emitted

// Layout-only field types don't create database columns.
const LAYOUT_FIELD_TYPES = new Set<string>();

export function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

/**
 * Given a Nextly field config, returns the database column shape
 * for the requested dialect. Returns `null` for layout-only field
 * types that don't get a column.
 *
 * The output is consumed by:
 *   - `runtime-schema-generator.ts` — translates `kind` +
 *     `length` + `nullable` to a Drizzle column builder
 *   - `pipeline/diff/build-from-fields.ts` — translates
 *     `dialectType` + `nullable` to a `ColumnSpec`
 */
export function getColumnDescriptor(
  field: FieldDefinition,
  dialect: SupportedDialect
): ColumnDescriptor | null {
  if (LAYOUT_FIELD_TYPES.has(field.type)) return null;

  const name = toSnakeCase(field.name);
  const kind = classifyFieldKind(field);
  // FK columns are always created without NOT NULL in the DDL (both generateMigrationSQL
  // and the Drizzle runtime builder). `required` is enforced at the application layer.
  const nullable = kind === "fkSingle" ? true : field.required !== true;

  if (kind === "skip") return null;

  // Decimal fields carry precision/scale (author-set or the DECIMAL(10,2)
  // default); every other kind ignores them.
  const decimal =
    kind === "decimal"
      ? {
          precision: field.precision ?? DEFAULT_DECIMAL_PRECISION,
          scale: field.scale ?? DEFAULT_DECIMAL_SCALE,
        }
      : undefined;

  const dialectType = renderDialectType(kind, dialect, {
    length: undefined,
    precision: decimal?.precision,
    scale: decimal?.scale,
  });
  const length = lengthForKind(kind);

  return {
    name,
    dialectType,
    ...(length !== undefined ? { length } : {}),
    ...(decimal ? { precision: decimal.precision, scale: decimal.scale } : {}),
    nullable,
    kind,
  };
}

/**
 * Maps a field config to a logical column kind. Centralises the
 * field-type to column-kind matrix that used to live in two
 * dialect-specific switches per file. The hasMany / relationTo[]
 * "promote relationship to JSON" rule lives here too; previously
 * `build-from-fields.ts` ignored it and shipped wrong types.
 */
function classifyFieldKind(field: FieldDefinition): ColumnKind {
  switch (field.type) {
    case "text":
    case "email":
    case "password":
    case "select":
    case "radio":
      return "text";

    case "textarea":
    case "richText":
    case "code":
      return "longText";

    case "number": {
      // A hasMany number is written as a JSON array (the mutation path
      // stringifies it), so it must be stored as JSON, not a scalar numeric
      // column, regardless of dbType.
      if (field.hasMany) return "json";
      // Code-first fields opt into exact fractional storage via
      // `dbType: "decimal"` (DECIMAL/NUMERIC), the right choice for money.
      if (field.dbType === "decimal") return "decimal";
      // UI-created fields carry options.format === "float" for float storage;
      // code-first without dbType defaults to integer, matching the DDL emitted
      // by dynamic-collection-schema-service.ts.
      return field.options?.format === "float" ? "double" : "integer";
    }

    case "checkbox":
      return "boolean";

    case "date":
      return "timestamp";

    case "relationship":
    case "upload": {
      // hasMany or array-target relationships are stored as JSON
      // arrays of FK ids. Single-target -> plain FK column.
      const hasMany = (field as { hasMany?: boolean }).hasMany;
      const relationTo = (field as { relationTo?: unknown }).relationTo;
      if (hasMany || Array.isArray(relationTo)) return "json";
      return "fkSingle";
    }

    case "repeater":
    case "group":
    case "component":
    case "json":
    case "chips":
      return "json";

    default: {
      // Plugin-contributed custom field type maps to its declared storage
      // primitive; otherwise fall back to text (legacy default — no change).
      const custom = getFieldType(field.type);
      if (custom) return STORAGE_TO_COLUMN_KIND[custom.storage] ?? "text";
      return "text";
    }
  }
}

/**
 * Translates a logical kind to the per-dialect introspection
 * token. Mirrors what the live-DB introspect step returns:
 *   - PG udt_name (abbreviated, lowercase)
 *   - MySQL COLUMN_TYPE (full declared type as written)
 *   - SQLite PRAGMA type (declared type as written, lowercase)
 *
 * `length` is honored for varchar (MySQL); ignored for other kinds
 * since their dialect tokens don't carry length.
 */
function renderDialectType(
  kind: ColumnKind,
  dialect: SupportedDialect,
  opts: { length?: number; precision?: number; scale?: number }
): string {
  const { length } = opts;
  if (kind === "decimal") {
    // The diff normalizes precision away (numeric(10,2) -> "numeric"), so a
    // decimal column never triggers a phantom type change; precision is carried
    // for the emitter. Trade-off: a later precision/scale change on an existing
    // column (e.g. 10,2 -> 12,4) is NOT detected as a diff, because the live
    // introspector reports only the base type. Resizing a decimal column needs
    // a manual migration until the introspector captures numeric_precision/
    // numeric_scale on the live side.
    const p = opts.precision ?? DEFAULT_DECIMAL_PRECISION;
    const s = opts.scale ?? DEFAULT_DECIMAL_SCALE;
    if (dialect === "postgresql") return `numeric(${p}, ${s})`;
    if (dialect === "mysql") return `decimal(${p},${s})`;
    return "numeric"; // sqlite stores as NUMERIC affinity
  }
  if (kind === "text") {
    if (dialect === "postgresql") return "text";
    if (dialect === "mysql") return `varchar(${length ?? 255})`;
    return "text"; // sqlite
  }
  if (kind === "longText") {
    if (dialect === "postgresql") return "text";
    if (dialect === "mysql") return "text";
    return "text"; // sqlite
  }
  if (kind === "varchar") {
    if (dialect === "postgresql") return "text";
    if (dialect === "mysql") return `varchar(${length ?? 255})`;
    return "text"; // sqlite
  }
  if (kind === "boolean") {
    if (dialect === "postgresql") return "bool";
    if (dialect === "mysql") return "tinyint(1)";
    return "integer"; // sqlite (boolean mode)
  }
  if (kind === "integer") {
    if (dialect === "postgresql") return "int4";
    if (dialect === "mysql") return "int";
    return "integer"; // sqlite
  }
  if (kind === "double") {
    if (dialect === "postgresql") return "float8";
    if (dialect === "mysql") return "double";
    return "real"; // sqlite
  }
  if (kind === "timestamp") {
    if (dialect === "postgresql") return "timestamp";
    if (dialect === "mysql") return "timestamp";
    return "integer"; // sqlite (timestamp mode)
  }
  if (kind === "json") {
    if (dialect === "postgresql") return "jsonb";
    if (dialect === "mysql") return "json";
    return "text"; // sqlite stores JSON as text
  }
  if (kind === "fkSingle") {
    if (dialect === "postgresql") return "text";
    if (dialect === "mysql") return "varchar(36)";
    return "text"; // sqlite
  }
  // Unreachable: skip is filtered out before this is called.
  return "text";
}

/**
 * Returns the length for kinds that carry one. Used by both the
 * dialect-token rendering and the runtime Drizzle builder.
 */
function lengthForKind(kind: ColumnKind): number | undefined {
  if (kind === "text") return 255;
  if (kind === "varchar") return 255;
  if (kind === "fkSingle") return 36;
  return undefined;
}

// ============================================================================
// Reserved system columns
// ============================================================================

/**
 * Reserved system columns that BOTH consumers inject (id, created_at,
 * updated_at always; title/slug only when not user-defined; status only
 * when enabled). Owned here so the two paths stay in lockstep when the
 * system-column set evolves.
 */
export interface SystemColumnSet {
  /** True if user provided a `title` field — skip the auto-injected one. */
  hasTitleField: boolean;
  /** True if user provided a `slug` field — skip the auto-injected one. */
  hasSlugField: boolean;
  /**
   * True if Draft/Published status is enabled on this collection/single.
   * When set, a `status` column (varchar/text NOT NULL DEFAULT 'draft') is
   * injected. Existing rows backfill to 'draft' so unpublished content
   * never leaks during the migration that adds the column.
   */
  hasStatus?: boolean;
}

export interface SystemColumnDescriptor {
  name: string;
  dialectType: string;
  length?: number;
  nullable: boolean;
  primaryKey: boolean;
  // Raw default expression as written in DDL (e.g. "'draft'" for status).
  // Must match what runtime-schema-generator.ts emits so the diff doesn't
  // classify ADD COLUMN as an interactive "required field with no default."
  default?: string;
}

export function getSystemColumnDescriptors(
  dialect: SupportedDialect,
  opts: SystemColumnSet
): SystemColumnDescriptor[] {
  const cols: SystemColumnDescriptor[] = [];
  if (dialect === "postgresql") {
    cols.push({
      name: "id",
      dialectType: "text",
      nullable: false,
      primaryKey: true,
    });
    if (!opts.hasTitleField) {
      cols.push({
        name: "title",
        dialectType: "text",
        nullable: false,
        primaryKey: false,
      });
    }
    if (!opts.hasSlugField) {
      cols.push({
        name: "slug",
        dialectType: "text",
        nullable: false,
        primaryKey: false,
      });
    }
    // Timestamp defaults must mirror runtime-schema-generator's
    // pgTimestamp(...).defaultNow() — otherwise the diff sees a phantom
    // change_column_default (now() → undefined) on every apply and routes
    // around the fast-path DDL emitter.
    cols.push({
      name: "created_at",
      dialectType: "timestamp",
      nullable: true,
      primaryKey: false,
      default: "now()",
    });
    cols.push({
      name: "updated_at",
      dialectType: "timestamp",
      nullable: true,
      primaryKey: false,
      default: "now()",
    });
    if (opts.hasStatus) {
      // Must mirror runtime-schema-generator's
      // pgVarchar("status", { length: 20 }).notNull().default("draft").
      // information_schema reports udt_name=varchar for that DDL, so
      // emitting "text" here would cause a phantom change_column_type
      // on every apply.
      cols.push({
        name: "status",
        dialectType: "varchar",
        length: 20,
        nullable: false,
        primaryKey: false,
        default: "'draft'",
      });
    }
  } else if (dialect === "mysql") {
    cols.push({
      name: "id",
      dialectType: "varchar(36)",
      length: 36,
      nullable: false,
      primaryKey: true,
    });
    if (!opts.hasTitleField) {
      cols.push({
        name: "title",
        dialectType: "varchar(255)",
        length: 255,
        nullable: false,
        primaryKey: false,
      });
    }
    if (!opts.hasSlugField) {
      cols.push({
        name: "slug",
        dialectType: "varchar(255)",
        length: 255,
        nullable: false,
        primaryKey: false,
      });
    }
    cols.push({
      name: "created_at",
      dialectType: "timestamp",
      nullable: true,
      primaryKey: false,
    });
    cols.push({
      name: "updated_at",
      dialectType: "timestamp",
      nullable: true,
      primaryKey: false,
    });
    if (opts.hasStatus) {
      cols.push({
        name: "status",
        dialectType: "varchar(20)",
        length: 20,
        nullable: false,
        primaryKey: false,
        default: "'draft'",
      });
    }
  } else {
    // sqlite
    cols.push({
      name: "id",
      dialectType: "text",
      nullable: false,
      primaryKey: true,
    });
    if (!opts.hasTitleField) {
      cols.push({
        name: "title",
        dialectType: "text",
        nullable: false,
        primaryKey: false,
      });
    }
    if (!opts.hasSlugField) {
      cols.push({
        name: "slug",
        dialectType: "text",
        nullable: false,
        primaryKey: false,
      });
    }
    cols.push({
      name: "created_at",
      dialectType: "integer",
      nullable: true,
      primaryKey: false,
    });
    cols.push({
      name: "updated_at",
      dialectType: "integer",
      nullable: true,
      primaryKey: false,
    });
    if (opts.hasStatus) {
      cols.push({
        name: "status",
        dialectType: "text",
        nullable: false,
        primaryKey: false,
        default: "'draft'",
      });
    }
  }
  return cols;
}
