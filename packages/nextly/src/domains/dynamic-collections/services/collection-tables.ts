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

/**
 * The registry's table name for each collection slug.
 *
 * `keysRelationTo` marks a map read for a Schema Builder collection's own keys
 * (`builderKeyTables`). Only such a map lets a relationship that names its
 * target by `relationTo`, as the admin writes it, carry a key: a Single or a
 * code-first table goes through the same DDL, and D18 keeps their relationships
 * as they are (`relationshipKeyTarget`).
 */
export interface CollectionTables extends ReadonlyMap<string, string> {
  readonly keysRelationTo?: true;
}

/**
 * `tables`, marked as read for a Schema Builder collection's own keys, so a
 * relationship naming its target by `relationTo` is keyed to the table the
 * map holds for it (`relationshipKeyTarget`).
 */
export function builderKeyTables(
  tables: Iterable<readonly [string, string]>
): CollectionTables {
  return Object.assign(new Map(tables), { keysRelationTo: true as const });
}

/** Whether `field` names one target a key could point at, by `relationTo` or `options.target`. */
function namesOneTarget(field: FieldDefinition, readRelationTo: boolean) {
  if (field.type !== "relationship") return false;
  if (readRelationTo && typeof field.relationTo === "string") return true;
  return Boolean(field.options?.target);
}

/**
 * Read with `reader`, a connection or the transaction a save runs in, two columns per row, for the
 * keys of `fields`. Only a relationship naming a target has a key, and a key belongs to a field at
 * the top of its table (a nested one is stored inside its parent's value), so where no top-level
 * field names a target there is nothing to resolve and nothing is read.
 *
 * With `builder`, the map is read for a Schema Builder collection's own keys: a relationship that
 * names its target by `relationTo` counts as naming one, and the map is marked so the schema
 * service keys it (`builderKeyTables`).
 */
export async function collectionTablesBySlug(
  reader: Pick<TransactionContext, "select">,
  fields: readonly FieldDefinition[],
  options: { builder?: boolean } = {}
): Promise<CollectionTables | undefined> {
  const builder = options.builder === true;
  if (!fields.some(field => namesOneTarget(field, builder))) return undefined;
  const rows = await reader.select<{ slug: string; tableName: string }>(
    "dynamic_collections",
    { columns: ["slug", "tableName"] }
  );
  const entries = rows.map(row => [row.slug, row.tableName] as const);
  return builder ? builderKeyTables(entries) : new Map(entries);
}
