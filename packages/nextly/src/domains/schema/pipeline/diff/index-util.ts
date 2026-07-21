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

/**
 * Map every index in a live snapshot to the table that owns it.
 *
 * Owner lookup used to be guessed from the index name by walking prefixes,
 * which works for the Postgres-style `<table>_<column>_idx` but not for the
 * `idx_<table>_<column>` Nextly actually emits: `idx_dc_city_slug` yields
 * `idx_dc_city`, `idx_dc`, `idx` and never `dc_city`. Every Nextly index
 * therefore failed to resolve. Introspection already records the true owner,
 * so ask it rather than infer, which also covers index names a user chose
 * that no naming convention could predict.
 *
 * Keys are lower-cased because identifier casing differs across dialects.
 */
export function buildIndexOwnerMap(snapshot: {
  tables: ReadonlyArray<{ name: string; indexes?: ReadonlyArray<IndexSpec> }>;
}): Map<string, string> {
  const owners = new Map<string, string>();
  for (const table of snapshot.tables) {
    for (const index of table.indexes ?? []) {
      owners.set(index.name.toLowerCase(), table.name);
    }
  }
  return owners;
}
