/**
 * Registry rows, kept for a second: collections' as
 * `DynamicCollectionRegistryService.getCollection` reads them, and Singles' and
 * components' as their registry services' `getRecordBySlug` does.
 *
 * A single read of an entry looks its collection up several times, and every
 * lookup was a round trip. Here the first read of a slug goes to the database
 * and the reads within the next second are answered from memory.
 *
 * Every registry change this process makes clears the cache at once, so the
 * process that made it never serves the old row. A change made elsewhere (by
 * another instance, the CLI or a migration) is seen once the cached row's
 * second is up: that lifetime is the bound on how long it can go unseen.
 *
 * Each caller gets its own copy, so an edit to what it was handed cannot reach
 * the next caller.
 *
 * A read made on a transaction never comes from that cache: it must see the
 * transaction's own uncommitted registry writes, and what it reads must reach
 * no other transaction. It is held instead by the transaction's own memo
 * (`registryRowOnTransaction`), read once per transaction and slug, and gone
 * with the transaction. One update of an entry looks its collections up many
 * times, and inside a write each lookup was a round trip.
 *
 * The memo answers only while what it holds can still be the row the
 * transaction would read:
 * - every registry write calls `clearRegistryRowCache` as it writes, inside
 *   the transaction as well as after it commits, and a clear makes every
 *   memo read again, as it does the cache;
 * - a row read by a part of the transaction that has since rolled back to its
 *   savepoint is read again, since the rollback may have taken its write;
 * - a hold on registry rows (`forgetRegistryRowsOnTransaction`) reads them
 *   again, so the rows the transaction then holds are the latest committed;
 * - a missing row is never kept, as in the cache.
 *
 * @module domains/dynamic-collections/services/collection-row-cache
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionInFlow } from "@nextlyhq/adapter-drizzle/types";

import { isWithinLifetime, monotonicNow } from "../../../shared/lib/lifetime";
import { readsOnTransactionNow } from "../../../shared/lib/read-transaction-scope";

/**
 * How long a cached row is served before it is read again: the bound on how
 * long a change made outside this process goes unseen.
 */
export const COLLECTION_ROW_LIFETIME_MS = 1000;

interface CachedRow {
  row: Record<string, unknown>;
  readAt: number;
  /** The cache's generation when the read began: served only while current. */
  generation: number;
}

/** A row a transaction read, held for the rest of it (`registryRowOnTransaction`). */
interface MemoizedRow {
  /**
   * The read, shared by every caller asking while it is under way: a write
   * looks its collections up several times at once. Settles to a copy kept
   * for the memo alone, or null for a missing row, which is not kept.
   */
  row: Promise<Record<string, unknown> | null>;
  /** The cache's generation when the read began: served only while current. */
  generation: number;
  /** Whether the part of the transaction that read it has rolled back since. */
  undone: () => boolean;
}

interface CacheState {
  /** Moved by every clear, so a row read before one is never kept after it. */
  generation: number;
  /** Rows by slug, per database: one process may hold several. */
  byDatabase: WeakMap<object, Map<string, CachedRow>>;
  /**
   * Rows by table and slug, per open transaction, keyed by the object the
   * adapter knows it by (`TransactionInFlow.transaction`): gone with it.
   */
  byTransaction?: WeakMap<object, Map<string, MemoizedRow>>;
}

// On `globalThis`: a Next.js dev server holds several module registries, and a
// cache per registry would be several caches, each cleared only by the writes
// made through its own copy of this module.
const globalForCache = globalThis as unknown as {
  __nextly_collectionRowCache?: CacheState;
};

function cacheState(): CacheState {
  globalForCache.__nextly_collectionRowCache ??= {
    generation: 0,
    byDatabase: new WeakMap(),
  };
  return globalForCache.__nextly_collectionRowCache;
}

/** Forget every cached row: a collection's, a Single's or a component's registry row changed. */
export function clearRegistryRowCache(): void {
  cacheState().generation += 1;
}

/** A collection's registry row, cached as `cachedRegistryRow` caches any. */
export async function cachedCollectionRow(
  database: object,
  slug: string,
  read: () => Promise<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  return cachedRegistryRow(database, "dynamic_collections", slug, read);
}

/**
 * The row for `slug` in the registry table `table` on `database`: a copy of the cached one while it is
 * within its lifetime and no clear has happened since its read began,
 * otherwise `read()`'s, which is then kept. A read a clear overtakes may hold
 * the row from before the change: it is kept under the generation it began
 * in, so it is never served.
 */
export async function cachedRegistryRow<
  T extends Record<string, unknown> | null,
>(
  database: object,
  table: string,
  slug: string,
  read: () => Promise<T>
): Promise<T> {
  const key = `${table}\u0000${slug}`;
  const cache = cacheState();
  let rows = cache.byDatabase.get(database);
  const hit = rows?.get(key);
  if (
    hit !== undefined &&
    hit.generation === cache.generation &&
    isWithinLifetime(hit.readAt, COLLECTION_ROW_LIFETIME_MS)
  ) {
    return structuredClone(hit.row) as T;
  }
  const generation = cache.generation;
  // Timed from before the read, so the lifetime never outlasts the moment the
  // database answered.
  const readAt = monotonicNow();
  const row = await read();
  // A missing row is never kept: a register committing a moment later must be seen at once,
  // however its clear and its commit fall around this read.
  if (row === null) return row;
  if (rows === undefined) {
    rows = new Map();
    cache.byDatabase.set(database, rows);
  }
  rows.set(key, { row: structuredClone(row), readAt, generation });
  return row;
}

/**
 * The open transaction a registry read made through `adapter`, on `executor`
 * where one is given, runs on, or none when it does not run on one: outside
 * any transaction, or inside one while reading through the pool. A read is on
 * the transaction when it is handed the transaction's executor, or when
 * `adapter` is a view whose reads run there (`readsOnTransactionNow`).
 */
export function registryReadTransaction(
  adapter: TransactionReporter,
  executor: unknown
): TransactionInFlow | undefined {
  if (executor === undefined && !readsOnTransactionNow(adapter)) {
    return undefined;
  }
  return transactionOf(adapter);
}

/** What the memo asks of an adapter: the transaction a call is made inside. */
type TransactionReporter = Partial<Pick<DrizzleAdapter, "transactionInFlow">>;

/**
 * The open transaction the calling flow is inside, as `adapter` reports it.
 * An adapter that cannot say (one built without `transactionInFlow`, such as
 * a stand-in) reports none, and its reads on a transaction are read every
 * time, as they were before the memo.
 */
function transactionOf(
  adapter: TransactionReporter
): TransactionInFlow | undefined {
  return typeof adapter.transactionInFlow === "function"
    ? adapter.transactionInFlow()
    : undefined;
}

/** The memo of `transaction`, made on first use. */
function memoOf(transaction: TransactionInFlow): Map<string, MemoizedRow> {
  const cache = cacheState();
  cache.byTransaction ??= new WeakMap();
  let rows = cache.byTransaction.get(transaction.transaction);
  if (rows === undefined) {
    rows = new Map();
    cache.byTransaction.set(transaction.transaction, rows);
  }
  return rows;
}

/**
 * The row for `slug` in the registry table `table`, as `read()` reads it on
 * `transaction`: once per transaction, then a copy of what that read
 * returned, while no clear has happened since it began and the part of the
 * transaction that made it has not rolled back. Callers asking while the read
 * is under way share it. Every caller inside one transaction is answered from
 * the same memo, and no other transaction is. `table` names the key space as
 * `cachedRegistryRow`'s does: rows of one shape share one.
 */
export async function registryRowOnTransaction<
  T extends Record<string, unknown> | null,
>(
  transaction: TransactionInFlow,
  table: string,
  slug: string,
  read: () => Promise<T>
): Promise<T> {
  const key = `${table}\u0000${slug}`;
  const cache = cacheState();
  const rows = memoOf(transaction);
  let entry = rows.get(key);
  if (
    entry === undefined ||
    entry.generation !== cache.generation ||
    entry.undone()
  ) {
    entry = {
      generation: cache.generation,
      undone: () => transaction.undone(),
      row: read().then(row => (row === null ? null : structuredClone(row))),
    };
    rows.set(key, entry);
  }
  const held = entry;
  // A failed read and a missing row are not kept, as in the cache: the next
  // caller reads again, and a row another transaction commits a moment later
  // is then seen where the dialect's isolation shows it.
  const forget = (): void => {
    if (rows.get(key) === held) rows.delete(key);
  };
  let row: Record<string, unknown> | null;
  try {
    row = await held.row;
  } catch (error) {
    forget();
    throw error;
  }
  if (row === null) {
    forget();
    return null as T;
  }
  return structuredClone(row) as T;
}

/**
 * Forget the rows the open transaction `adapter`'s calling flow runs in has
 * read, so its next read of each goes to the database: for a hold on
 * registry rows, after which the transaction reads the latest committed rows.
 */
export function forgetRegistryRowsOnTransaction(
  adapter: TransactionReporter
): void {
  const transaction = transactionOf(adapter);
  if (transaction !== undefined) {
    cacheState().byTransaction?.delete(transaction.transaction);
  }
}
