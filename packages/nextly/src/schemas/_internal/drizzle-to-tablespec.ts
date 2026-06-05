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

import { getTableColumns, getTableName, type Table } from "drizzle-orm";

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
  const drizzleColumns = getTableColumns(table);

  const columns: ColumnSpec[] = Object.values(drizzleColumns).map(col => ({
    name: col.name,
    type: normalizeDrizzleType(col),
    nullable: !col.notNull,
    default: extractDefault(col),
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
  getSQLType?: () => string;
}): string {
  if (typeof col.getSQLType === "function") {
    try {
      return col.getSQLType().toLowerCase();
    } catch {
      // Some column subclasses throw if called without a configured table;
      // fall through to the dataType fallback below.
    }
  }
  return col.dataType.toLowerCase();
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
  // SQL-expression defaults arrive as objects (or, rarely, functions/symbols);
  // these have no meaningful primitive coercion (`String({})` →
  // "[object Object]"), so serialize them deterministically instead.
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
