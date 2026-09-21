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
  return `${idx.columns.join(",")}|${idx.unique ? "u" : "n"}`;
}

/**
 * Only our own indexes (idx_/uq_ prefixes) may be dropped. Primary keys and
 * external/composite indexes we don't manage are never dropped.
 */
export function isManagedIndexName(name: string): boolean {
  if (name.endsWith("_pkey")) return false;
  return name.startsWith("idx_") || name.startsWith("uq_");
}
