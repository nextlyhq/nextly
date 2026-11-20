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
 * A write that waited while the collection was deleted, or deleted and made again under its slug,
 * is refused rather than written into what took its place: the hold compares the registry row it
 * holds with the one read before the write's transaction opened (`expectedRegistryIdOf`).
 *
 * @module domains/collections/services/entry-write-hold
 */
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import type { DynamicCollectionService } from "../../dynamic-collections";

/** What the hold is taken through: the registry's `holdCollectionsIn`, and its read of a row. */
export type CollectionHolder = Pick<
  DynamicCollectionService,
  "holdCollectionsIn" | "getCollection"
>;

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
  dialect: SupportedDialect,
  /** The registry row the write is made for (`expectedRegistryIdOf`); absent, not compared. */
  expected?: string
): Promise<void> {
  if (dialect !== "mysql") return;
  const held = heldIn.get(tx);
  if (held?.has(slug)) return;
  const { existing, ids } = await holder.holdCollectionsIn(tx, [slug], "share");
  if (expected !== undefined) refuseReplaced(slug, expected, existing, ids);
  if (held === undefined) heldIn.set(tx, new Set([slug]));
  else held.add(slug);
}

/**
 * The id of collection `slug`'s registry row, for an entry write about to open its transaction, on
 * MySQL: read before it opens, so the write's transaction takes its view of the database only once
 * it holds the collection (a view taken before would meet a table a deleting save has since
 * changed). While a delete holds the collection it has not committed, so this is the row the write
 * is made for. Undefined elsewhere, where no hold is taken, inside a transaction already open in the
 * flow (whose connection a pool of one has no second for), and where no row holds the slug.
 */
export async function expectedRegistryIdOf(
  holder: CollectionHolder,
  slug: string,
  adapter: { transactionOpenInFlow(): boolean },
  dialect: SupportedDialect
): Promise<string | undefined> {
  if (dialect !== "mysql" || adapter.transactionOpenInFlow()) return undefined;
  let row: { id?: unknown } | null | undefined;
  try {
    row = (await holder.getCollection(slug)) as
      | { id?: unknown }
      | null
      | undefined;
  } catch (error) {
    if (NextlyError.isCode(error, "NOT_FOUND")) return undefined;
    throw error;
  }
  const id = row?.id;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : undefined;
}

/**
 * Refuses a write whose collection's registry row is not the one read before its transaction opened
 * (`expected`): gone, or another row under the same slug, made while the write waited for a
 * delete. Nothing of the write has run.
 */
function refuseReplaced(
  slug: string,
  expected: string,
  existing: readonly string[],
  ids: ReadonlyMap<string, string>
): void {
  if (!existing.includes(slug)) {
    throw NextlyError.notFound({
      message: "Collection not found.",
      logContext: { reason: "collection-deleted-while-held", slug },
    });
  }
  if (ids.get(slug) === expected) return;
  throw new NextlyError({
    code: "COLLECTION_BEING_CHANGED",
    publicMessage:
      "This collection is being changed elsewhere. Try again in a moment.",
    logContext: { reason: "collection-replaced-while-held", slug },
  });
}
