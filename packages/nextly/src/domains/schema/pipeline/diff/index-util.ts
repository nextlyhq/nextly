import {
  fieldProducesColumn,
  toSnakeCase,
} from "../../services/field-column-descriptor";

import {
  type ColumnCastContext,
  normalizeCheckExpression,
  normalizeExpressionList,
} from "./normalize-check";
import type { ColumnSpec, IndexSpec, TableSpec } from "./types";

/**
 * A stable logical key for matching desired vs live indexes.
 *
 * Column ORDER is significant and is preserved here. It decides which
 * left-prefix lookups an index can serve, so `(a, b)` and `(b, a)` are
 * different indexes and a change from one to the other must diff as a drop
 * plus an add rather than as no change at all.
 *
 * This previously sorted the columns. That was harmless while every emitted
 * index had exactly one column — sorting a single-element list is a no-op — and
 * would have silently merged two different compound indexes the moment one was
 * emitted. No existing comparison changes, because none compared a multi-column
 * index.
 */
export function indexKey(idx: IndexSpec, columns?: ColumnCastContext): string {
  // The predicate and expression are part of the identity: a changed
  // WHERE re-keys the index, which the diff reads as drop-plus-add rather
  // than leaving two indexes that differ only in what they filter. Plain
  // indexes append two empty strings, so every existing key is unchanged.
  //
  // Both are compared by what they MEAN. A server keeps neither as written:
  // PostgreSQL deparses `deleted_at IS NULL` to `(deleted_at IS NULL)` and
  // `lower(email)` to `lower((email)::text)`, MySQL backticks every name.
  // Compared as text, a declared partial or expression index never matched
  // its live self and was planned again on every push. The check normaliser
  // already reads every one of those spellings as syntax, and a predicate or
  // an index expression is the same kind of boolean-or-scalar SQL a check is.
  //
  // An expression is a KEY LIST — `lower(email), status` — read one key at a
  // time; read whole, a list falls outside the grammar and compares as raw
  // text, which never matches the server's spelling of the same keys.
  const expression =
    idx.expression === undefined || idx.expression === ""
      ? ""
      : normalizeExpressionList(idx.expression, columns);
  return `${idx.columns.join(",")}|${idx.unique ? "u" : "n"}|${canonical(idx.where, columns)}|${expression}`;
}

/** An index predicate in its canonical spelling, or "" for none. */
function canonical(
  sql: string | undefined,
  columns: ColumnCastContext | undefined
): string {
  return sql === undefined || sql === ""
    ? ""
    : normalizeCheckExpression(sql, columns);
}

/**
 * The cast context for one side's index expressions: its text-like columns,
 * the only ones PostgreSQL wraps in an inserted `::text` cast.
 */
export function textColumnsOf(
  columns: readonly ColumnSpec[]
): ColumnCastContext {
  return {
    textColumns: new Set(
      columns
        .filter(column => TEXT_LIKE.test(column.type))
        .map(column => column.name.toLowerCase())
    ),
  };
}

const TEXT_LIKE =
  /^\s*(?:varchar|character varying|char|character|bpchar|text|tinytext|mediumtext|longtext|citext|string)\b/i;

/**
 * Only our own indexes (idx_/uq_ prefixes) may be dropped. Primary keys and
 * external/composite indexes we don't manage are never dropped.
 */
export function isManagedIndexName(name: string): boolean {
  if (name.endsWith("_pkey")) return false;
  return name.startsWith("idx_") || name.startsWith("uq_");
}

/**
 * Names a declared index may use that are not fields: the system columns
 * every collection table carries, spelled as the API spells them.
 */
const SYSTEM_INDEX_NAMES: ReadonlySet<string> = new Set([
  "id",
  "createdAt",
  "updatedAt",
]);

/** What one name in a declared index's `fields` resolves to. */
export type DeclaredIndexTarget<F> =
  | { kind: "field"; field: F }
  | { kind: "system"; column: string }
  | { kind: "refused"; message: string };

/**
 * Which column, if any, a name in a declared index's `fields` stands for.
 *
 * The one answer to "which names may an index use": collection validation
 * asks it when the collection is defined and the schema build asks it when
 * the table is built, so a name the first accepts is never one the second
 * refuses. Kept as two lists they had already drifted — the validator
 * accepted the system timestamps and nested group children, and the build
 * refused both on every push and every migration.
 *
 * A nested name is refused rather than mapped: a group or repeater keeps its
 * children together in one JSON column, so a child has no column of its own.
 */
export function resolveDeclaredIndexName<
  F extends { name: string; type?: unknown; options?: unknown },
>(
  fieldName: string,
  fields: readonly F[],
  localizedNames: ReadonlySet<string>
): DeclaredIndexTarget<F> {
  const field = fields.find(f => f.name === fieldName);
  if (field !== undefined) {
    // A localized field's column lives in the migration-owned `_locales`
    // table, so an index on it here would name a column this table lacks.
    if (localizedNames.has(fieldName)) {
      return {
        kind: "refused",
        message: `Index names the localized field "${fieldName}", whose column lives in the companion "_locales" table.`,
      };
    }
    if (!fieldProducesColumn(field)) {
      return {
        kind: "refused",
        message: `Index names the field "${fieldName}", which materialises no column on this table.`,
      };
    }
    return { kind: "field", field };
  }
  if (SYSTEM_INDEX_NAMES.has(fieldName)) {
    return { kind: "system", column: toSnakeCase(fieldName) };
  }
  if (fieldName.includes(".")) {
    return {
      kind: "refused",
      message: `Index names "${fieldName}", a field nested inside another. A group or repeater stores its children in one JSON column, so a nested field has no column of its own to index.`,
    };
  }
  return {
    kind: "refused",
    message: `Index names the field "${fieldName}", which this entity does not declare. An index may name a top-level field or ${[...SYSTEM_INDEX_NAMES].join(", ")}.`,
  };
}

/**
 * A table's indexes by the key the diff pairs them on (`indexKey`), each read against the table's
 * own column types. The one place that pairing is made: the diff plans from it, and the push asks
 * it which live indexes stand in for declared ones, so the two can never disagree about a match.
 */
export function keyedIndexes(
  indexes: readonly IndexSpec[],
  columns: readonly ColumnSpec[]
): Map<string, IndexSpec> {
  const context = textColumnsOf(columns);
  return new Map(indexes.map(index => [indexKey(index, context), index]));
}

/**
 * The live indexes the diff counts as declared ones under another name: on a table in both
 * snapshots, a live index paired with a desired one (`keyedIndexes`) while its name is not that
 * index's.
 *
 * The diff plans nothing for such an index, since it already reads as the declared one, so it is
 * the only thing holding that index's guarantee: a unique one is the field's uniqueness. Anything
 * that removes it must be a planned `drop_index`, never a side effect, or the declared index is
 * left missing with nothing to put it back. An index no desired index is paired with is not
 * returned: whether such a one goes is the diff's to decide.
 */
export function liveIndexesStandingInForDeclared(
  desired: readonly TableSpec[],
  live: readonly TableSpec[]
): { tableName: string; indexName: string }[] {
  const liveByName = new Map(live.map(table => [table.name, table]));
  const found: { tableName: string; indexName: string }[] = [];
  for (const table of desired) {
    const liveTable = liveByName.get(table.name);
    if (liveTable?.indexes === undefined || table.indexes === undefined) {
      continue;
    }
    const declared = keyedIndexes(table.indexes, table.columns);
    for (const [key, index] of keyedIndexes(
      liveTable.indexes,
      liveTable.columns
    )) {
      const declaredIndex = declared.get(key);
      if (declaredIndex !== undefined && declaredIndex.name !== index.name) {
        found.push({ tableName: table.name, indexName: index.name });
      }
    }
  }
  return found;
}
