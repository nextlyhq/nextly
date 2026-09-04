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

import { NextlyError } from "../../../errors/nextly-error";
import {
  SYSTEM_COLUMNS,
  systemColumnDefaultSql,
  systemColumnDialectType,
  type SystemColumnDefault,
  type SystemColumnEntity,
  type SystemColumnKind,
  type SystemColumnPresence,
} from "../../../lib/system-columns";
import { isBuiltInFieldType } from "../../../schemas/_zod/ui-schema";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { isFieldGroupType } from "../../field-groups/storage/field-group-field-type";
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
  | "shortText" // PG/MySQL: varchar(N), SQLite: text — a text field explicitly declared short
  | "varchar" // varchar(N) explicitly (uses `length`)
  | "boolean" // PG: bool, MySQL: tinyint(1), SQLite: integer(boolean mode)
  | "integer" // PG: int4, MySQL: int, SQLite: integer
  | "double" // PG: float8, MySQL: double, SQLite: real
  | "decimal" // exact DECIMAL/NUMERIC(precision, scale); PG/SQLite: numeric, MySQL: decimal
  | "timestamp" // PG/MySQL: timestamp, SQLite: integer(timestamp mode)
  | "json" // PG: jsonb, MySQL: json, SQLite: text
  | "fkSingle" // single-target foreign key — text/varchar(36)
  | "skip"; // the field keeps its values in another table — no column emitted

export function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

/**
 * The physical columns a list of fields occupies.
 *
 * Anything deciding "has the author already declared this system field?" has to ask it of the
 * COLUMN rather than the spelling. `Title` and `title` are one column, so injecting the system
 * field beside an author's `Title` declares that column twice and the table cannot be created.
 * Four places make that decision — both config factories, the dev-server single sync and the
 * single dispatcher's alter input — and this is the one definition they share.
 *
 * A field that occupies no column claims none: a component or a many-to-many named `Title` keeps
 * its values in its own table, so the system column still has to be injected beside it. Counting
 * it would drop the system field from the config while the generators still emit the column.
 *
 * Takes loosely-typed fields because two of those callers run before the config has been parsed.
 */
export function columnsDeclaredBy(
  fields: Iterable<
    { name?: unknown; type?: unknown; options?: unknown } | null | undefined
  >
): Set<string> {
  const columns = new Set<string>();
  for (const field of fields) {
    if (!field || typeof field.name !== "string") continue;
    if (!fieldProducesColumn(field)) continue;
    columns.add(toSnakeCase(field.name));
  }
  return columns;
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
  // Field-group and component values live in their own dedicated tables (fg_{slug} or
  // comp_{slug}) and are stripped from the parent row on write, so the parent needs no column.
  if (isFieldGroupType(field.type)) return false;
  // A many-to-many relationship stores its links in a dedicated junction table, not on the parent
  // row. Every other relationship shape does get a column.
  if (usesJunctionTable(field)) return false;
  return true;
}

/**
 * Whether a field's values live in a junction table instead of a column on its own row.
 *
 * The DDL generator asks this to decide whether to emit a junction table, and `fieldProducesColumn`
 * asks it to decide there is no parent column — one rule, so the two cannot disagree about the same
 * field. They did disagree, and the disagreement was resolved toward the row: an `upload` carrying
 * `relationType: "manyToMany"` had no descriptor column while the generator emitted one.
 *
 * **Junction storage is a `relationship` feature only**, deliberately, because that is the only
 * shape the persistence layer implements. Both halves select junction-backed fields by type:
 * `collection-mutation-service` filters `f.type === "relationship" && relationType === "manyToMany"`
 * on every write, and `collection-relationship-service` builds its relation set from
 * `isRelationshipField`, which is `field.type === "relationship"`. Treating an upload as
 * junction-backed would give it a table that nothing writes to and nothing reads from, so an upload
 * keeps its column and the option is inert on it.
 */
export function usesJunctionTable(field: {
  type?: unknown;
  options?: unknown;
}): boolean {
  if (field.type !== "relationship") return false;
  const options: unknown = field.options;
  const relationType =
    typeof options === "object" && options !== null
      ? (options as { relationType?: unknown }).relationType
      : undefined;
  return relationType === "manyToMany";
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
  dialect: SupportedDialect,
  builtBy: ColumnOrigin
): ColumnDescriptor | null {
  const name = toSnakeCase(field.name);
  // "skip" covers every column-less field type via fieldProducesColumn: a component
  // and a many-to-many, both of which keep their values in another table.
  const kind = classifyFieldKind(field, builtBy);
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

  const length = lengthForField(kind, field, builtBy);

  const dialectType = renderDialectType(kind, dialect, {
    length,
    precision: decimal?.precision,
    scale: decimal?.scale,
  });

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
 * Which string kind a text-storing field asks for, from what it says about its own width.
 *
 * Only a field that reaches a string column may state a width: an email, a password and a select
 * value are bounded by what they hold, while free text is bounded by nothing. Silence keeps the
 * answer this path has always given, so the signal only ever adds information — a caller that KNOWS
 * a field is unbounded can say so instead of discovering the ceiling when a paste is rejected, and
 * on MySQL the two render 255 characters apart.
 *
 * One function rather than a branch per caller: a plugin-contributed type declaring `storage: "text"`
 * lands in the same column as a built-in text field and is rendered by the same branch, so it has to
 * answer this question the same way. Asking it in only one of the two places left a contributed
 * field the caller had declared unbounded sitting in a bounded column.
 */
/**
 * Which builder made the table a column belongs to.
 *
 * A text field that states no width does not have one right answer: three builders exist and they
 * read a width from different keys and read silence differently. That is a property of the ENTITY,
 * never of the field, so it is passed in rather than guessed from the field's shape.
 *
 * Stated as a required argument on purpose. Every consumer that decided a column's shape without
 * this fact got it wrong for at least one builder — the localization intent parser, Single identity
 * seeding, the incremental column path, the companion `_locales` layer — and each was found one at a
 * time by review. Required, a consumer that has not decided does not compile.
 */
export type ColumnOrigin =
  /**
   * `DynamicCollectionSchemaService`, which builds collections AND singles. Bounds a text column on
   * `options.variant === "short"` and takes the width from `validation.maxLength`; anything else is
   * unbounded.
   */
  | "collection"
  /**
   * `FieldGroupSchemaService`. Bounds on a top-level `maxLength` and reads no variant at all, so a
   * field saying it is both short and 120 characters is bounded by the 120 and nothing else.
   */
  | "fieldGroup"
  /**
   * The pipeline's Drizzle builder, which is this module's own default and therefore what every
   * code-first table was built with. It reads `options.variant` both ways and treats a choice list
   * as unbounded; a field stating none of those gets the bounded default.
   *
   * Those readings are the rule this module applied before any builder was named, kept verbatim
   * because they describe columns that already exist. Simplifying this to "the bounded default"
   * proposed narrowing every code-first MySQL column that had been created unbounded.
   */
  | "codeFirst";

/**
 * The kind a text-storing field gets, according to the builder that owns its table.
 *
 * One function, three rules, stated once. Keeping the rules here rather than normalising the fields
 * before they arrive is what stops a value synthesised for one consumer reaching another that reads
 * the same key for a different purpose.
 */
function textKindFor(
  field: FieldDefinition,
  builtBy: ColumnOrigin
): ColumnKind {
  const options = field.options;

  // Read by no builder as a width. `options` is also the choice list on a select and the payload
  // schema permits that shape on any field, so a field carrying one states nothing about its column.
  const variant = Array.isArray(options) ? undefined : options?.variant;

  // A `slug` column is indexed by every generator that creates one, and MySQL cannot index an
  // unbounded string without a prefix length. So this one column is bounded whoever built the
  // table: it is a constraint of the column, not a reading of a width the field never stated.
  //
  // Stated here rather than at the creators, because the paths that ADD a slug column to a table
  // that already exists go through this function and never through them. Left to each creator, a
  // freshly created table and a repaired one disagreed about the same column, and on MySQL the
  // repaired one could not carry the index.
  //
  // Not for a field group: only the entities that carry a slug identity column index it, and a
  // field group's creator indexes its parent pointer and its own unique fields instead. Bounding
  // it there would bound a column for a constraint that table does not have, and its creator
  // strips a contributed type's `maxLength` before mapping — so a plugin field that happens to be
  // named `slug` would be described bounded while it is created as TEXT.
  if (builtBy !== "fieldGroup" && toSnakeCase(field.name) === "slug") {
    return declaredMaxLength(field, builtBy) !== undefined
      ? "shortText"
      : "text";
  }

  switch (builtBy) {
    case "collection":
      if (variant === "short") return "shortText";
      // Silence is unbounded here, which is the opposite of the code-first default and the reason
      // this argument exists: the same declaration is 65 535 characters on a Builder table and 255
      // on a code-first one, on MySQL.
      return "longText";

    case "fieldGroup":
      // A declared width wins outright, because this builder never looks at the variant: a field
      // saying `{ maxLength: 120, variant: "long" }` is created bounded, and reading the variant
      // described as unbounded a column that was built bounded.
      //
      // Only for a type this schema names, though. This creator strips `maxLength` (with `dbType`,
      // `precision`, `scale` and `options`) from a CONTRIBUTED type before mapping it — a plugin's
      // keys are its own, and one that happens to be spelled `maxLength` must not reshape the
      // column — so it builds such a field unbounded. Reading it here bounded a column the creator
      // had just made unbounded, which reports a type change on an untouched column.
      return isBuiltInFieldType(String(field.type)) &&
        declaredMaxLength(field, builtBy) !== undefined
        ? "shortText"
        : "longText";

    case "codeFirst":
      // These four lines ARE the rule this module applied before any builder was named, and that
      // rule is what the pipeline's builder used to create every code-first column that exists. So
      // this branch keeps it exactly: describing an existing column any other way proposes a change
      // to a column nobody touched, and two of these readings are unbounded — narrowing them on
      // MySQL refuses or truncates whatever is already past 255 characters.
      //
      // What 122 changed is not this. The Schema Builder's creators read a width from other keys
      // and read silence differently, and applying THESE rules to their tables was the defect.
      if (variant === "long") return "longText";
      if (variant === "short") return "shortText";
      // `options` is the choice list on a select, and the payload schema permits that shape on any
      // field, so a field carrying one states no width and is left unbounded.
      if (Array.isArray(options)) return "longText";
      return "text";

    default:
      // Unreachable through the type, and reachable from an untyped caller. Refused rather than
      // defaulted: the whole point of naming the builder is that no column shape is chosen by
      // accident, and returning a kind here would put back the silent default this replaced.
      throw NextlyError.internal({
        logContext: {
          reason: "column_origin_missing",
          builtBy: String(builtBy),
          field: field.name,
        },
      });
  }
}

/**
 * Whether a kind stores a string, so a caller holding a string has somewhere valid to put it.
 *
 * Asked here rather than restated as a list of kind names by each caller: the kinds that store text
 * are a property of the kind set, so a set that grows has one place to say whether the new member
 * belongs. A caller carrying its own copy silently answered "no" for a kind added after it.
 */
export function isTextStorageKind(kind: ColumnKind): boolean {
  return (
    kind === "text" ||
    kind === "longText" ||
    kind === "shortText" ||
    kind === "varchar"
  );
}

/**
 * Maps a field config to a logical column kind. Centralises the
 * field-type to column-kind matrix that used to live in two
 * dialect-specific switches per file. The hasMany / relationTo[]
 * "promote relationship to JSON" rule lives here too; previously
 * `build-from-fields.ts` ignored it and shipped wrong types.
 */
function classifyFieldKind(
  field: FieldDefinition,
  builtBy: ColumnOrigin
): ColumnKind {
  if (!fieldProducesColumn(field)) return "skip";

  switch (field.type) {
    case "text":
      return textKindFor(field, builtBy);

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
      // A junction-backed relationship is already excluded by fieldProducesColumn, which owns
      // that rule. An upload never is, so `relationType: "manyToMany"` on one falls through to the
      // ordinary shapes below: hasMany or array-target is a JSON array of FK ids, single-target a
      // plain FK column. That matches what the write path does with it.
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
      if (custom) {
        const kind = STORAGE_TO_COLUMN_KIND[custom.storage] ?? "text";
        // A contributed type that stores text answers the same width question a built-in text
        // field does, and its column is rendered by the same branch, so it is asked in the same
        // way. Answering it here with a narrower rule left a contributed field bounded while the
        // creators made it unbounded, which reports an untouched column as a narrowing.
        return kind === "text" ? textKindFor(field, builtBy) : kind;
      }
      // An unregistered type: the field schema accepts any slug-shaped token, so a stored field can
      // name a type whose plugin is not loaded. It lands in a text column like the rest of this
      // branch, so it answers the width question the same way rather than being forced to the
      // bounded default.
      return textKindFor(field, builtBy);
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
  if (kind === "shortText") {
    // SQLite has one string type, so a short field is `text` there and the bound lives in
    // validation alone — which is what the generators emit for it too.
    if (dialect === "sqlite") return "text";
    return `varchar(${length ?? 255})`;
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
function lengthForField(
  kind: ColumnKind,
  field: FieldDefinition,
  builtBy: ColumnOrigin
): number | undefined {
  // The one kind a field asks for by declaring a width, so it is the one kind built at the width
  // asked for. The others are sized by what they hold, not by the field.
  //
  // What this width does NOT do is survive a later edit: `normalize-type.ts` strips the modifier
  // before the diff compares, so widening an existing column from 120 to 500 is invisible to
  // convergence and no resize is emitted. Creating at the declared width is still strictly better
  // than creating at 255 — a field declaring 500 characters otherwise gets a column that rejects
  // what its own stored validation accepts — but resizing needs the diff to compare widths first.
  if (kind === "shortText") return declaredMaxLength(field, builtBy) ?? 255;
  if (kind === "text") return 255;
  if (kind === "varchar") return 255;
  if (kind === "fkSingle") return 36;
  return undefined;
}

/**
 * The width a field declares, read from the key its own builder sizes a bounded column from.
 *
 * The two builders read different keys, which is the whole reason builtBy is passed: a field group's
 * width is a top-level `maxLength`, and a collection's is `validation.maxLength` alongside a short
 * variant. Reading both for either one is what made a field declaring 120 characters come out 255
 * through one path and 120 through the other.
 *
 * A top-level `length` is deliberately consulted by neither. No builder sizes a column from it, so
 * honouring it would give a declaration a capacity nothing else agrees with — and because the diff
 * strips length modifiers, nothing would ever reconcile the two afterwards.
 *
 * Rejects anything that is not a whole positive count. These reach DDL as `VARCHAR(n)`, so a
 * fraction, a zero or a negative would be rendered into the statement as written and the create
 * would fail on a value the field system had already accepted.
 */
function declaredMaxLength(
  field: FieldDefinition,
  builtBy: ColumnOrigin
): number | undefined {
  // A field group's fields reach here through the same entry point but carry their width at the top
  // level, which `FieldDefinition` does not name.
  const declared =
    builtBy === "fieldGroup"
      ? (field as { maxLength?: unknown }).maxLength
      : field.validation?.maxLength;
  if (typeof declared !== "number") return undefined;
  if (!Number.isInteger(declared) || declared <= 0) return undefined;
  return declared;
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
