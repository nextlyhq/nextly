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

import {
  SYSTEM_COLUMNS,
  systemColumnDefaultSql,
  systemColumnDialectType,
  type SystemColumnDefault,
  type SystemColumnEntity,
  type SystemColumnKind,
  type SystemColumnPresence,
} from "../../../lib/system-columns";
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
 * Whether a field becomes a column of the table it is declared on.
 *
 * The single answer to that question: `classifyFieldKind` and `getColumnDescriptor` both defer to
 * it, so a rule that only applies to columns cannot disagree with the generator about which fields
 * have one.
 *
 * Dialect-free by construction — a component and a many-to-many relationship keep their values in
 * their own tables on every dialect. Structural rather than typed because config validation asks
 * this before the field has been parsed. Anything unrecognised counts as a column, matching the
 * text fallback below, so a field type whose plugin has not registered yet is still held to the
 * rules that columns carry rather than quietly escaping them.
 */
export function fieldProducesColumn(field: {
  type?: unknown;
  options?: unknown;
}): boolean {
  if (typeof field.type !== "string") return true;
  if (LAYOUT_FIELD_TYPES.has(field.type)) return false;
  // Component values live in their own comp_{slug} tables and are stripped from the parent row on
  // write, so the parent needs no column.
  if (field.type === "component") return false;
  // A many-to-many relationship stores its links in a dedicated junction table, not on the parent
  // row. Every other relationship shape does get a column.
  if (field.type === "relationship" || field.type === "upload") {
    const options: unknown = field.options;
    const relationType =
      typeof options === "object" && options !== null
        ? (options as { relationType?: unknown }).relationType
        : undefined;
    return relationType !== "manyToMany";
  }
  return true;
}

/**
 * Given a Nextly field config, returns the database column shape
 * for the requested dialect. Returns `null` for every field type
 * that gets no column of its own — see `fieldProducesColumn`.
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
  const name = toSnakeCase(field.name);
  // "skip" covers every column-less field type, layout ones included, via fieldProducesColumn.
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
  if (!fieldProducesColumn(field)) return "skip";

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
      // Many-to-many is already excluded by fieldProducesColumn, which owns the junction-table
      // rule. hasMany or array-target relationships are stored as JSON arrays of FK ids.
      // Single-target -> plain FK column.
      const hasMany = (field as { hasMany?: boolean }).hasMany;
      const relationTo = (field as { relationTo?: unknown }).relationTo;
      if (hasMany || Array.isArray(relationTo)) return "json";
      return "fkSingle";
    }

    case "repeater":
    case "group":
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
  /**
   * True for a Single's table. Singles are a single global row with no
   * per-user owner, so the `created_by` owner column is NOT injected (owner-only
   * access is a collection concept). Keeps the runtime schema, the diff input,
   * and the DDL in lockstep — otherwise a Single's runtime schema would select
   * a column its physical table never gets.
   */
  isSingle?: boolean;
}

export interface SystemColumnDescriptor {
  name: string;
  /**
   * The column family, for consumers that build a column rather than describe one.
   *
   * The runtime Drizzle generator dispatches on this. It used to dispatch on the NAME, with a
   * fall-through that made every unrecognised column non-null text, so a newly declared timestamp
   * would be created as a timestamp and read through a text column.
   */
  kind: SystemColumnKind;
  dialectType: string;
  length?: number;
  nullable: boolean;
  primaryKey: boolean;
  // Raw default expression as written in DDL (e.g. "'draft'" for status).
  // Must match what runtime-schema-generator.ts emits so the diff doesn't
  // classify ADD COLUMN as an interactive "required field with no default."
  default?: string;
  /** The same default, before it was rendered as DDL, for callers that need the value itself. */
  defaultValue?: SystemColumnDefault;
}

/**
 * Whether a declared column is part of a table built with `opts`.
 *
 * `title` and `slug` step aside for an author's own fields of those names, and the lifecycle pair
 * exists only where Draft/Published is enabled.
 */
function isPresent(
  presence: SystemColumnPresence,
  opts: SystemColumnSet
): boolean {
  switch (presence) {
    case "always":
      return true;
    case "unlessAuthorDeclaredTitle":
      return !opts.hasTitleField;
    case "unlessAuthorDeclaredSlug":
      return !opts.hasSlugField;
    case "withStatusLifecycle":
      return opts.hasStatus === true;
  }
}

/**
 * The system columns of one table, in declaration order.
 *
 * A projection of `SYSTEM_COLUMNS` rather than a per-dialect listing of its own: the three dialect
 * branches this replaced restated the same eight columns three times, so a column added to one
 * could be missed in another, and the set was invisible to every consumer that is not a DDL
 * generator.
 */
export function getSystemColumnDescriptors(
  dialect: SupportedDialect,
  opts: SystemColumnSet
): SystemColumnDescriptor[] {
  const entity: SystemColumnEntity = opts.isSingle ? "single" : "collection";

  return SYSTEM_COLUMNS.filter(
    column =>
      column.appliesTo.includes(entity) && isPresent(column.presence, opts)
  ).map(column => {
    const shape = column.shape[dialect];
    const defaultSql = systemColumnDefaultSql(shape, dialect);
    return {
      name: column.name,
      kind: shape.kind,
      dialectType: systemColumnDialectType(shape, dialect),
      ...(shape.length !== undefined ? { length: shape.length } : {}),
      nullable: shape.nullable,
      primaryKey: shape.primaryKey === true,
      ...(defaultSql !== undefined ? { default: defaultSql } : {}),
      ...(shape.default !== undefined ? { defaultValue: shape.default } : {}),
    };
  });
}

/**
 * Spell one system-column descriptor as the column definition of a `CREATE TABLE`.
 *
 * The module that owns what the columns ARE owns how they are written, so a DDL generator can
 * iterate `getSystemColumnDescriptors` instead of restating the set. Restating it is what let a
 * newly added system column reach the runtime schema and miss the physical table, which makes
 * every read of that entity select a column that is not there.
 *
 * `quoteIdentifier` is the caller's, because quoting is a property of the generator's dialect
 * handling rather than of the column.
 *
 * Clause order is `type [DEFAULT x] [PRIMARY KEY] [NOT NULL]`, which is what the generators
 * already emitted by hand. A default is a literal DDL expression (`now()`, `'draft'`), not a
 * value to be escaped: the descriptor stores it exactly as it must appear.
 */
export function renderSystemColumnSql(
  column: SystemColumnDescriptor,
  quoteIdentifier: (name: string) => string
): string {
  // `length` is redundant on some dialects and load-bearing on others: MySQL's descriptors carry
  // the size inside `dialectType` ("varchar(36)") as well as in `length`, while PostgreSQL's
  // status column is "varchar" with the 20 held only in `length`. Appending unconditionally would
  // emit "varchar(36)(36)", so the size is added only when the type does not already state one.
  const statesItsOwnSize = column.dialectType.includes("(");
  const type =
    column.length === undefined || statesItsOwnSize
      ? column.dialectType
      : `${column.dialectType}(${column.length})`;

  const clauses = [quoteIdentifier(column.name), type];
  if (column.default !== undefined) clauses.push(`DEFAULT ${column.default}`);
  if (column.primaryKey) clauses.push("PRIMARY KEY");
  // A primary key is already NOT NULL on every dialect, and the generators spelled it out. Kept
  // so the emitted text does not change for the columns that were not the point of this.
  if (!column.nullable) clauses.push("NOT NULL");

  return clauses.join(" ");
}
