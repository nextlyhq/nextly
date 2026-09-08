/**
 * Convert a Drizzle table object (compile-time definition) into a TableSpec
 * (runtime snapshot type used by the diff engine).
 *
 * The emitted type tokens MUST eventually match what `introspectLiveSnapshot`
 * returns for the same column so that `diff(desired, live)` finds zero
 * differences when the schema is in sync. See build-from-fields.ts for the
 * type-token alignment contract (Phase 5 / 2026-05-01 note).
 *
 * Produces the shape `getCoreSchema()` needs: table name, columns, and — when
 * the caller names a dialect — the table's declared INDEXES.
 *
 * 🔴 Indexes are why the dialect argument exists. Omitting them does not make
 * the comparison conservative, it makes it blind: `diffIndexes` skips a table
 * whose `indexes` is `undefined`, so an index-only release produced no
 * operations at all, `reconcileCore` returned `changed: false` before reaching
 * the push, and the index reached fresh databases only. Every upgraded
 * installation kept the table scan the new index existed to remove, with
 * nothing anywhere reporting a difference.
 *
 * Reading them needs the dialect because the accessor is per dialect —
 * `getTableConfig` is exported separately by pg-core, mysql-core and
 * sqlite-core, and a `Table` does not say which one it came from. A caller
 * with no dialect to give still gets the columns-only spec, which is what
 * `undefined` has always meant here.
 *
 * @module schemas/_internal/drizzle-to-tablespec
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { getColumns, getTableName, type Table } from "drizzle-orm";
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";

import type {
  ColumnSpec,
  IndexSpec,
  TableSpec,
} from "../../domains/schema/pipeline/diff/types";

/**
 * One declared index, read from whichever dialect described it.
 *
 * Narrowed from `unknown` rather than asserted into a shared interface: the
 * three `getTableConfig` functions each return their OWN `Index` type, and the
 * column entries differ enough between them that no single assertion satisfies
 * all three without lying about at least one.
 */
function indexSpecOf(candidate: unknown): IndexSpec | undefined {
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const config = (candidate as { config?: unknown }).config;
  if (typeof config !== "object" || config === null) return undefined;
  const { name, unique, columns, where } = config as {
    name?: unknown;
    unique?: unknown;
    columns?: unknown;
    where?: unknown;
  };
  if (typeof name !== "string") return undefined;
  // 🔴 PARTIAL indexes are dropped, because `IndexSpec` cannot express one: it
  // is a name, a column list and a uniqueness flag, with nowhere to put the
  // predicate. Including one asserts an UNCONDITIONAL index the database does
  // not have, so the diff proposes adding it, the push writes nothing new, and
  // the next run proposes it again -- measured on PostgreSQL as four indexes
  // re-proposed forever, which made `reconcileCore` report a change on every
  // run against a database it had just written.
  //
  // Omitting them is the honest reading rather than a workaround: an index this
  // type cannot describe is one the diff does not track, which is what leaving
  // it out has always meant here. Nothing is put at risk -- `diffIndexes` only
  // drops names it manages (`idx_`/`uq_` prefixes), and no core index is named
  // that way.
  if (where !== undefined && where !== null) return undefined;
  const names = Array.isArray(columns)
    ? columns.flatMap(column => {
        const columnName = (column as { name?: unknown } | null)?.name;
        return typeof columnName === "string" ? [columnName] : [];
      })
    : [];
  return { name, columns: names, unique: unique === true };
}

/**
 * The indexes a table declares, as the diff engine spells them.
 *
 * A table whose accessor cannot be read contributes NO index data rather than
 * an empty list: `[]` asserts "this table has none", which would invite
 * dropping indexes that were merely unreadable, while `undefined` keeps the
 * pre-existing "not tracked" meaning that makes `diffIndexes` skip the table.
 */
function declaredIndexes(
  table: Table,
  dialect: SupportedDialect
): IndexSpec[] | undefined {
  try {
    // A switch rather than a lookup, because the three accessors are generic
    // over their own dialect's table type: as a union they share no callable
    // signature, and each `case` is one concrete function applied to one handle.
    const declared: unknown[] | undefined = (() => {
      switch (dialect) {
        case "postgresql":
          return pgTableConfig(table as never).indexes;
        // No `as never` here, unlike its neighbours: the MySQL accessor takes a
        // plain `Table`, while the PostgreSQL and SQLite ones are generic over
        // their own dialect's table type and reject a bare `Table`.
        case "mysql":
          return mysqlTableConfig(table).indexes;
        case "sqlite":
          return sqliteTableConfig(table as never).indexes;
        default:
          return undefined;
      }
    })();
    if (!declared) return undefined;
    return declared.flatMap(entry => {
      const spec = indexSpecOf(entry);
      return spec ? [spec] : [];
    });
  } catch {
    // A handle this accessor cannot read is UNKNOWN, not empty.
    return undefined;
  }
}

/**
 * Convert one Drizzle table to a TableSpec.
 *
 * @param table - a Drizzle table object (pgTable, mysqlTable, or sqliteTable result)
 * @param dialect - which dialect's accessor to read indexes with. Omitted, the
 *   spec carries columns alone and the diff skips this table's index dimension.
 * @returns TableSpec with `name` and `columns`, plus `indexes` when a dialect
 *   was given.
 */
export function drizzleTableToTableSpec(
  table: Table,
  dialect?: SupportedDialect
): TableSpec {
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

  const indexes = dialect ? declaredIndexes(table, dialect) : undefined;
  return { name, columns, ...(indexes ? { indexes } : {}) };
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
