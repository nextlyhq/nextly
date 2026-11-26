/**
 * PostgreSQL's index builders for the core tables' described indexes, and the
 * descriptions with them, for that dialect's table modules.
 *
 * @module schemas/_internal/core-indexes-postgres
 */
import { index, uniqueIndex } from "drizzle-orm/pg-core";

import type { CoreIndex } from "./core-indexes";

export * from "./core-indexes";

type IndexColumn = Parameters<ReturnType<typeof index>["on"]>[0];

/** PostgreSQL index builders for `indexes`, over a table's extra-config columns. */
export function pgIndexes<K extends string>(
  indexes: readonly CoreIndex<K>[],
  table: Record<K, IndexColumn>
) {
  return indexes.map(({ name, unique, columns: [head, ...tail] }) =>
    (unique ? uniqueIndex : index)(name).on(
      table[head],
      ...tail.map(key => table[key])
    )
  );
}
