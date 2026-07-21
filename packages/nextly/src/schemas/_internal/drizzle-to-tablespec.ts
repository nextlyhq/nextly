/**
 * Convert a Drizzle table object (compile-time definition) into a TableSpec
 * (runtime snapshot type used by the diff engine).
 *
 * The emitted type tokens MUST eventually match what `introspectLiveSnapshot`
 * returns for the same column so that `diff(desired, live)` finds zero
 * differences when the schema is in sync. See build-from-fields.ts for the
 * type-token alignment contract (Phase 5 / 2026-05-01 note).
 *
 * Plan A scope: this utility produces the shape needed by `getCoreSchema()`
 * (table name + columns with name/type/nullable/default). Indexes and
 * constraints are out of scope — the diff engine treats absence as "no
 * structural constraint to compare against." Plan C will extend this if
 * Phase 1 needs richer comparison for core-schema reconciliation.
 *
 * @module schemas/_internal/drizzle-to-tablespec
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import { getColumns, getTableName, type Table } from "drizzle-orm";

import type {
  ColumnSpec,
  TableSpec,
} from "../../domains/schema/pipeline/diff/types";

/**
 * Convert one Drizzle table to a TableSpec.
 *
 * @param table - a Drizzle table object (pgTable, mysqlTable, or sqliteTable result)
 * @returns TableSpec with `name` and `columns` populated. Indexes and
 *   constraints are intentionally omitted.
 */
export function drizzleTableToTableSpec(table: Table): TableSpec {
  const name = getTableName(table);
  // Drizzle v1 exposes table column metadata through getColumns()
  // (the pre-v1 accessor is deprecated); the TableSpec conversion below is
  // unchanged — only the metadata accessor moved.
  const drizzleColumns = getColumns(table);

  const columns: ColumnSpec[] = Object.values(drizzleColumns).map(col => ({
    name: col.name,
    type: normalizeDrizzleType(col),
    nullable: !col.notNull,
    default: extractDefault(col),
    // Recorded so the diff can exempt primary keys from the nullability
    // comparison. Drizzle sets `primary` on the column for `.primaryKey()`
    // in every dialect; a composite key declared through the table's extra
    // config leaves it false, which is correct here — this exemption is
    // about the single-column form the dialects render inconsistently.
    ...(col.primary === true ? { primaryKey: true } : {}),
  }));

  return { name, columns };
}

/**
 * Normalize a Drizzle column's type to a lowercase token.
 *
 * Prefer `getSQLType()` when available — it returns the rendered SQL type
 * (`"text"`, `"varchar(255)"`, `"timestamp"` etc.) that matches what the live
 * introspector reads back from `information_schema`. Fall back to `dataType`
 * (Drizzle's coarse-grained category: `"string"`, `"number"`, `"boolean"`,
 * `"date"`, `"json"`, `"bigint"`) when no SQL renderer is available.
 *
 * Plan C may need finer-grained mapping per dialect; for now this is enough
 * for the public-API contract and downstream snapshot emission.
 */
function normalizeDrizzleType(col: {
  columnType: string;
  dataType: string;
  dimensions?: number;
  getSQLType?: () => string;
}): string {
  let base: string | undefined;
  if (typeof col.getSQLType === "function") {
    try {
      base = col.getSQLType().toLowerCase();
    } catch {
      // Some column subclasses throw if called without a configured table;
      // fall through to the dataType fallback below.
    }
  }
  base ??= col.dataType.toLowerCase();

  // Array-ness lives in `dimensions`, not in the rendered type: Drizzle marks
  // `text("tags").array()` as PgText with dimensions 1, so getSQLType() returns
  // "text" for both a text column and a text[] column. Live introspection
  // reads PostgreSQL's `_text` for the array, which normalises to "text[]", so
  // omitting this reports a type change on a column nobody touched — and a
  // type change is destructive, which refuses the entire core reconcile.
  //
  // One suffix regardless of depth: PostgreSQL's udt_name is `_text` for any
  // dimensionality, so the live side cannot distinguish text[] from text[][]
  // and matching that keeps both sides comparable.
  const dimensions = col.dimensions ?? 0;
  return dimensions > 0 ? `${base}[]` : base;
}

/**
 * Extract a column's default expression as a string, if any.
 *
 * Drizzle's `default` property holds the raw value (`"now()"`, `0`, `false`,
 * or an SQL function reference). For Plan A we stringify it and rely on the
 * diff engine's tolerance for token equivalence; finer-grained default
 * canonicalisation is Plan C scope.
 */
function extractDefault(col: { default?: unknown }): string | undefined {
  const value = col.default;
  if (value === undefined || value === null) return undefined;
  // Primitive defaults (`"now()"`, 0, false, …) stringify directly as before.
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  // A Drizzle `sql` default renders to the text the database will store, so
  // the desired side can be compared with what introspection reads back. A
  // column declared `.default(sql`(unixepoch())`)` is reported by SQLite as
  // `(unixepoch())`; serialising the object instead produced a JSON blob that
  // could never equal it, so the column emitted a default change on every
  // diff and the reconcile never converged.
  const rendered = renderSqlChunks(value);
  if (rendered !== undefined) return rendered;

  // Anything else (functions, symbols, parameterised SQL) has no meaningful
  // primitive coercion, so serialize deterministically. That will not match
  // the live side, which costs a spurious op — the direction this pipeline
  // chooses over silently treating two different defaults as equal.
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/**
 * The SQL text of a Drizzle `sql` template, when it is entirely static.
 *
 * Drizzle holds a template as `queryChunks`; a chunk carrying a `value` array
 * of strings is literal SQL. Every chunk being literal means the whole
 * template is the text it spells, which is what the database stores and what
 * introspection reads back.
 *
 * Returns `undefined` for a template with a bound parameter. Those cannot be
 * rendered to the stored text without knowing how the dialect inlines them,
 * and guessing would compare two different defaults equal.
 */
function renderSqlChunks(value: object): string | undefined {
  const chunks = (value as { queryChunks?: unknown }).queryChunks;
  if (!Array.isArray(chunks) || chunks.length === 0) return undefined;

  const parts: string[] = [];
  for (const chunk of chunks) {
    const chunkValue = (chunk as { value?: unknown }).value;
    if (!Array.isArray(chunkValue)) return undefined;
    if (!chunkValue.every(part => typeof part === "string")) return undefined;
    parts.push(chunkValue.join(""));
  }
  return parts.join("");
}
