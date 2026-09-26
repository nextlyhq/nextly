import {
  normalizeCheckExpression,
  normalizeExpressionList,
} from "./normalize-check";
import type { IndexSpec } from "./types";

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
export function indexKey(idx: IndexSpec): string {
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
      : normalizeExpressionList(idx.expression);
  return `${idx.columns.join(",")}|${idx.unique ? "u" : "n"}|${canonical(idx.where)}|${expression}`;
}

/** An index predicate in its canonical spelling, or "" for none. */
function canonical(sql: string | undefined): string {
  return sql === undefined || sql === "" ? "" : normalizeCheckExpression(sql);
}

/**
 * Only our own indexes (idx_/uq_ prefixes) may be dropped. Primary keys and
 * external/composite indexes we don't manage are never dropped.
 */
export function isManagedIndexName(name: string): boolean {
  if (name.endsWith("_pkey")) return false;
  return name.startsWith("idx_") || name.startsWith("uq_");
}
