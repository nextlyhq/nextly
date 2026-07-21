import type { IndexSpec } from "./types";

/** A stable logical key for matching desired vs live indexes. */
export function indexKey(idx: IndexSpec): string {
  return `${[...idx.columns].sort().join(",")}|${idx.unique ? "u" : "n"}`;
}

/**
 * Only our own indexes (idx_/uq_ prefixes) may be dropped. Primary keys and
 * external/composite indexes we don't manage are never dropped.
 */
export function isManagedIndexName(name: string): boolean {
  if (name.endsWith("_pkey")) return false;
  return name.startsWith("idx_") || name.startsWith("uq_");
}
