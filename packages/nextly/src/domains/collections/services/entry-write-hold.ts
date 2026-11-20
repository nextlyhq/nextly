/**
 * An entry write's hold on its collection against a Builder save that deletes a field's values,
 * on MySQL.
 *
 * A save that removes a field holding values counts them again just before it deletes them, and
 * deletes only the count the person confirmed. On PostgreSQL and SQLite the save's own transaction
 * keeps other writes off the table from the count until it commits. MySQL commits each schema
 * statement as it runs, so no transaction holds the count and the delete together. There the save
 * takes its collection's hold for update (`holdCollectionsIn`, the hold a collection delete takes)
 * before it counts, and keeps it until its last deleting statement has run. Every entry write to
 * the collection takes the same hold's share side first in its transaction: it waits while such a
 * save is counting or deleting, and a save waits for writes already under way to commit.
 *
 * The share side is `holdCollectionsIn(tx, [slug], "share")`: the collection's named locks, taken
 * and released across a read of its registry row `FOR SHARE`, which then lasts until the write's
 * transaction ends. It is taken once per transaction and collection, so a batch that holds it
 * before its first item takes nothing more for each item.
 *
 * @module domains/collections/services/entry-write-hold
 */
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";

import type { DynamicCollectionService } from "../../dynamic-collections";

/** What the hold is taken through: the registry's `holdCollectionsIn`. */
export type CollectionHolder = Pick<DynamicCollectionService, "holdCollectionsIn">;

/** The collections each open transaction already holds for its entry writes. */
const heldIn = new WeakMap<TransactionContext, Set<string>>();

/**
 * Holds collection `slug` for an entry write in `tx`, before the write's first row statement: on
 * MySQL the share side of the collection's hold, once per transaction; elsewhere nothing, since a
 * deleting save's own transaction keeps writes off the table there. Refused, with nothing written,
 * when a save holds the collection past the hold's wait (`holdCollectionsIn`'s conflict).
 */
export async function holdEntityForWrite(
  tx: TransactionContext,
  slug: string,
  holder: CollectionHolder,
  dialect: SupportedDialect
): Promise<void> {
  if (dialect !== "mysql") return;
  const held = heldIn.get(tx);
  if (held?.has(slug)) return;
  await holder.holdCollectionsIn(tx, [slug], "share");
  if (held === undefined) heldIn.set(tx, new Set([slug]));
  else held.add(slug);
}
