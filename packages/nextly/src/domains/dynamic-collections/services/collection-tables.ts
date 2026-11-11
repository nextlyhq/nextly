/**
 * The table each Builder collection is stored in, by slug, as the registry records it.
 *
 * A collection is created under the table its slug spells (`getTableName`), and a rename keeps that
 * table: the slug moves, the table does not. A relationship names its target by slug, so the table
 * a key to it references cannot be spelled from the slug once the target has been renamed; it is
 * the one the target's registry row records. Every road that writes a key to a relationship's
 * target reads this map once and hands it to the schema service, which falls back to the spelled
 * name only for a target the registry does not hold.
 *
 * @module domains/dynamic-collections/services/collection-tables
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

/** The registry's table name for each collection slug. */
export type CollectionTables = ReadonlyMap<string, string>;

/**
 * Read with `reader`, a connection or the transaction a save runs in, two columns per row, for the
 * keys of `fields`. Only a relationship naming a target has a key, and a key belongs to a field at
 * the top of its table (a nested one is stored inside its parent's value), so where no top-level
 * field names a target there is nothing to resolve and nothing is read.
 */
export async function collectionTablesBySlug(
  reader: Pick<TransactionContext, "select">,
  fields: readonly FieldDefinition[]
): Promise<CollectionTables | undefined> {
  const keyed = fields.some(
    field => field.type === "relationship" && Boolean(field.options?.target)
  );
  if (!keyed) return undefined;
  const rows = await reader.select<{ slug: string; tableName: string }>(
    "dynamic_collections",
    { columns: ["slug", "tableName"] }
  );
  return new Map(rows.map(row => [row.slug, row.tableName]));
}
