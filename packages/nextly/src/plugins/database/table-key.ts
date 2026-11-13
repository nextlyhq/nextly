/**
 * A runtime table's one key column, wherever the table declares it.
 *
 * An entity's runtime table declares its key on the `id` column, except
 * SQLite's field-group table, which declares it on the table: drizzle-kit
 * reads a column-level key there as never NOT NULL, and a push that rebuilt
 * the table wrote an id that takes NULL. Every reader that needs the key asks
 * here, so a table declared either way is keyed alike.
 *
 * @module plugins/database/table-key
 */
import type { AnyColumn, Table } from "drizzle-orm";
import { getColumns, is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";

/** The table's single key column, or undefined when it has none or several. */
export function tableKeyColumn(runtime: Table): AnyColumn | undefined {
  const own = Object.values(getColumns(runtime)).find(column => column.primary);
  if (own !== undefined || !is(runtime, SQLiteTable)) return own;
  const keys = getTableConfig(runtime).primaryKeys;
  const [key] = keys;
  return keys.length === 1 && key.columns.length === 1
    ? key.columns[0]
    : undefined;
}
