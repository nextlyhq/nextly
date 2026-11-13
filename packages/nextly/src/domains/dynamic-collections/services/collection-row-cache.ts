/**
 * Registry rows, kept while the registry has not changed: collections' as
 * `DynamicCollectionRegistryService.getCollection` reads them, Singles' and
 * components' as their registry services' `getRecordBySlug` does, and each
 * registry table's whole listing as the registry services' reads for
 * presentation derive from it (`cachedRegistryListing`).
 *
 * A single read of an entry looks its collection up several times, and one
 * admin screen asks for the registry's slugs and records many times over; every
 * lookup was a round trip. Here the first read goes to the database and later
 * ones are answered from memory.
 *
 * Freshness follows the registry, not the clock. Each row is filed under the
 * count of registry writes the database stored when its read began
 * (`storedSchemaSeq`), and is served only while that count is the same. Every
 * registry write moves the count in its own transaction, whoever makes it, so:
 * - every registry change this process makes clears the cache at once, so the
 *   process that made it never serves the old row;
 * - a change made elsewhere (by another instance, the CLI or a migration) is
 *   seen once this process reads the count again: at most
 *   `SCHEMA_VERSION_READ_INTERVAL_MS` after its last read, the bound the
 *   served schema definitions follow too (`route-handler/schema-version`);
 * - while the count stays, nothing is read again, however long a request runs.
 *
 * The count is followed once this process has read it for the database (the
 * served schema version reads it on every server request), and read again
 * here whenever that read is older than the interval. Until then, and where
 * the count cannot be read (a database handle that is not an adapter, a
 * database without the stored version's table, a failed read), a row is
 * served for `COLLECTION_ROW_LIFETIME_MS` after its read, as before the count
 * was followed: a start, a CLI command or a script reads nothing more.
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
 * - a row read before any part of the transaction rolled back to its
 *   savepoint is read again, since the rollback may have taken a write the
 *   read saw, whichever part made it;
 * - only a read on the transaction's own connection is held: one handed an
 *   executor on the pool reads committed rows, and is read every time;
 * - a hold on registry rows (`forgetRegistryRowsOnTransaction`) reads them
 *   again, so the rows the transaction then holds are the latest committed;
 * - a missing row is never kept, as in the cache.
 *
 * @module domains/dynamic-collections/services/collection-row-cache
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionInFlow } from "@nextlyhq/adapter-drizzle/types";

import { isWithinLifetime, monotonicNow } from "../../../shared/lib/lifetime";
import { readExecutorOfView } from "../../../shared/lib/read-transaction-scope";
import {
  markSchemaChanged,
  SCHEMA_VERSION_READ_INTERVAL_MS,
  storedSchemaSeq,
} from "../../schema/stored-schema-seq";

/**
 * How long a cached row is served before it is read again where the stored
 * count of registry writes cannot be read: the bound, there, on how long a
 * change made outside this process goes unseen.
 */
export const COLLECTION_ROW_LIFETIME_MS = 1000;

/**
 * How long after a registry change made elsewhere commits this process may
 * still serve a row from before it: the interval the stored count is read at,
 * or the lifetime where the count cannot be read, whichever is longer.
 */
export const REGISTRY_ROW_STALENESS_MS = Math.max(
  COLLECTION_ROW_LIFETIME_MS,
  SCHEMA_VERSION_READ_INTERVAL_MS
);

interface CachedRow {
  /** A row, or a registry table's whole listing (`cachedRegistryListing`). */
  row: Record<string, unknown> | Record<string, unknown>[];
  readAt: number;
  /** The cache's generation when the read began: served only while current. */
  generation: number;
  /**
   * The stored count of registry writes when the read began: served only
   * while the count read now is the same. Undefined where it could not be
   * read, and then served by `readAt` alone.
   */
  seq: number | undefined;
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
  /** Whether any part of the transaction has rolled back since the read began. */
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
  // A registry write moves the stored count, and every write clears here
  // once it has committed: the count is read again by the next read, so what
  // it reads is filed under the count the write left rather than the one
  // before it, which would be read again once the interval ran out.
  markSchemaChanged();
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
 * The row for `slug` in the registry table `table` on `database`: a copy of
 * the cached one while it is fresh (`isFresh`), otherwise `read()`'s, which
 * is then kept. A read a clear or a moved count overtakes may hold the row
 * from before the change: it is kept under the generation and the count it
 * began in, so it is never served.
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
  const cached = await cachedRead(database, key, read);
  return cached as T;
}

/**
 * Every row of the registry table `table` on `database`, as `read()` lists
 * them, kept and refreshed as a row is, handed to `view` and answered with
 * what it returns. `view` is given the rows held for every caller: it derives
 * what its caller needs (the slugs, some columns, whole records) without
 * changing them, and hands out nothing of theirs that a caller could change,
 * copying what it keeps whole. One listing per table serves every narrower
 * view of it, so the views cannot come to disagree.
 */
export async function cachedRegistryListing<T>(
  database: object,
  table: string,
  read: () => Promise<Record<string, unknown>[]>,
  view: (rows: readonly Readonly<Record<string, unknown>>[]) => T
): Promise<T> {
  const key = `${table}\u0000\u0000listing`;
  const { hit, seq } = await freshHit(database, key);
  if (hit !== undefined) return view(hit.row as Record<string, unknown>[]);
  return view(await readAndKeep(database, key, seq, read));
}

/**
 * What is cached under `key` on `database`, where it may still be served, and
 * the stored count read now, which a fresh read is filed under.
 */
async function freshHit(
  database: object,
  key: string
): Promise<{ hit: CachedRow | undefined; seq: number | undefined }> {
  const seq = await storedSchemaSeq(database, { followedOnly: true });
  const cache = cacheState();
  const hit = cache.byDatabase.get(database)?.get(key);
  return {
    hit:
      hit !== undefined && isFresh(hit, cache.generation, seq)
        ? hit
        : undefined,
    seq,
  };
}

/** Whether `hit` may be served, the count read now being `seq`. */
function isFresh(
  hit: CachedRow,
  generation: number,
  seq: number | undefined
): boolean {
  if (hit.generation !== generation) return false;
  // The count followed where it can be read; the lifetime where it cannot.
  return seq !== undefined
    ? hit.seq === seq
    : isWithinLifetime(hit.readAt, COLLECTION_ROW_LIFETIME_MS);
}

/** A copy of the row cached under `key` while fresh, otherwise `read()`'s, kept. */
async function cachedRead(
  database: object,
  key: string,
  read: () => Promise<Record<string, unknown> | null>
): Promise<Record<string, unknown> | null> {
  const { hit, seq } = await freshHit(database, key);
  if (hit !== undefined) {
    return structuredClone(hit.row as Record<string, unknown>);
  }
  // The caller's own: the kept one is a copy.
  return readAndKeep(database, key, seq, read);
}

/**
 * Run `read` and keep what it answers under `key`, filed under the cache's
 * generation and the count `seq` as they were when it began, so a clear or
 * a moved count that overtakes it leaves it unserved. A missing row is never
 * kept: a register committing a moment later must be seen at once, however
 * its clear and its commit fall around this read.
 */
async function readAndKeep<
  T extends Record<string, unknown> | Record<string, unknown>[] | null,
>(
  database: object,
  key: string,
  seq: number | undefined,
  read: () => Promise<T>
): Promise<T> {
  const cache = cacheState();
  const generation = cache.generation;
  // Timed from before the read, so the lifetime never outlasts the moment the
  // database answered.
  const readAt = monotonicNow();
  const row = await read();
  if (row === null) return row;
  let rows = cache.byDatabase.get(database);
  if (rows === undefined) {
    rows = new Map();
    cache.byDatabase.set(database, rows);
  }
  rows.set(key, { row: structuredClone(row), readAt, generation, seq });
  return row;
}

/**
 * The open transaction a registry read made through `adapter`, on `executor`
 * where one is given, runs on, or none when it does not provably run on one.
 * The read's executor is `executor`, or, for a view whose reads run on a
 * transaction (`readExecutorOfView`), that transaction's. It runs on the open
 * transaction only when the adapter says that executor is the transaction's
 * own (`TransactionInFlow.runsOn`): an executor on the pool, handed in inside
 * a transaction (a read for a write, `findRecordForWrite`, outside a routed
 * scope), reads another connection's committed rows and is read every time.
 */
export function registryReadTransaction(
  adapter: TransactionReporter,
  executor: unknown
): TransactionInFlow | undefined {
  const on = executor ?? readExecutorOfView(adapter);
  if (on === undefined) return undefined;
  const transaction = transactionOf(adapter);
  return transaction?.runsOn(on) === true ? transaction : undefined;
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
 * returned, while no clear has happened since it began and no part of the
 * transaction has rolled back since. Callers asking while the read
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
