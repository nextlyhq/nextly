/**
 * Reads that run on a transaction the calling flow already holds.
 *
 * A plugin's handler that runs inside a write's transaction, or work inside
 * `ctx.services.collections.withTransaction`, may need to read its own
 * content. Read through the pool, that read takes a second connection while
 * the write holds its own: blind to what the transaction wrote, and, on a
 * pool of one connection (the usual serverless setting), waiting for a
 * connection the transaction will only give back once the read returns. It
 * waits until the pool times out.
 *
 * Inside {@link runReadsInTransaction}, every service built on `BaseService`
 * is handed {@link adapterForReads}'s view of its adapter instead of the
 * adapter itself, so its reads (`this.db`, `this.adapter.select`, `selectOne`,
 * `count`, `getDrizzle`, `executeQuery`, `queryStatement`, `tableExists`,
 * `listTables`) run on the transaction's own connection. What the view does
 * not route (a write, a transaction of its own) reaches the adapter as
 * before: a transaction opened inside the flow joins the one it is in.
 *
 * The view is handed out only while the transaction is still open in the
 * calling flow (`transactionOpenInFlow`). An effect a read registers to run
 * after the commit runs in the read's context, with this scope still set,
 * and must not reach a connection the transaction has given back.
 *
 * `AsyncLocalStorage` rather than a parameter: the reads that need it are
 * many layers below the plugin surface, through services that never took an
 * executor, and only this flow's reads may be routed.
 *
 * @module shared/lib/read-transaction-scope
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  CountOptions,
  DeleteOptions,
  InsertOptions,
  SelectOptions,
  SqlParam,
  TransactionContext,
  UpdateOptions,
  UpsertOptions,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";
import type { AnyRelations, SQL } from "drizzle-orm";

/**
 * The transaction a scope's reads run on, and whether the scope's own work
 * is still running. Work that outlives it (an effect registered inside it
 * and run after its transaction commits, which may open a transaction of
 * its own on the same adapter) inherits the record, finds it closed, and
 * reads on the pool, never on the finished transaction.
 */
interface ReadScope {
  readonly tx: TransactionContext;
  /** The lock a row read takes on PostgreSQL and MySQL, or none. */
  readonly lock: ReadLock;
  /**
   * Whether the services' positional writes (`insert`, `update`, `delete`,
   * `upsert` and their siblings) run on the transaction too, not only their
   * reads (`runReadsAndWritesInTransaction`).
   */
  readonly writes: boolean;
  live: boolean;
}

/**
 * The lock a routed row read takes on PostgreSQL and MySQL. `share` lets
 * other transactions read the rows and makes their writes wait; `update`
 * makes their locking reads wait too, for a read that goes on to write the
 * rows it read: two transactions that each held a shared lock on a row and
 * then wrote it would wait on each other, and the database would refuse one
 * of them.
 */
export type ReadLockStrength = "share" | "update";

/**
 * What a scope's row reads take on PostgreSQL and MySQL: a lock of
 * {@link ReadLockStrength}, or `none`, a plain read on the transaction's
 * connection that takes no row lock and waits for none.
 *
 * `none` is for a caller already holding a lock of its own (a lock row its
 * writes all take first, say) that reads rows another writer may be
 * updating. A locking read waits for that writer, and when the writer is
 * itself waiting for the caller's lock, the two wait on each other until the
 * database refuses one. The plain read does not wait. Under READ COMMITTED
 * (PostgreSQL's default) it sees the latest committed rows; under
 * REPEATABLE READ (MySQL's default) it answers from the transaction's
 * snapshot, which may predate a commit the caller's lock was meant to order
 * it after, and the caller must allow for that itself. Nothing it read is
 * held: another transaction may change those rows before this one ends.
 */
export type ReadLock = ReadLockStrength | "none";

const readTransaction = new AsyncLocalStorage<ReadScope>();

/**
 * Run `work` with every read its services make routed to `tx`, its row reads
 * taking `lock` (see {@link ReadLock}).
 */
export async function runReadsInTransaction<T>(
  tx: TransactionContext,
  work: () => Promise<T>,
  lock: ReadLock = "share"
): Promise<T> {
  const scope: ReadScope = { tx, lock, writes: false, live: true };
  try {
    return await readTransaction.run(scope, work);
  } finally {
    scope.live = false;
  }
}

/**
 * Run `work` with every read AND every positional write its services make
 * routed to `tx`, for work whose writes must commit or roll back as one with
 * a write the caller makes on `tx` itself: a registry row and the stored
 * schema version beside it (`domains/schema/schema-version`). Outside this,
 * a service's `this.adapter.insert` takes a pooled connection of its own and
 * commits whatever the transaction does.
 *
 * Its reads take no row lock (`none`): such a caller holds a lock of its own
 * (the schema lock), and a locking read of the rows it is about to write
 * would only make it wait on readers.
 */
export async function runReadsAndWritesInTransaction<T>(
  tx: TransactionContext,
  work: () => Promise<T>
): Promise<T> {
  const scope: ReadScope = { tx, lock: "none", writes: true, live: true };
  try {
    return await readTransaction.run(scope, work);
  } finally {
    scope.live = false;
  }
}

/** What the scope asks of an adapter. */
export type ReadingAdapter = Pick<
  DrizzleAdapter,
  "transactionOpenInFlow" | "getCapabilities"
>;

/**
 * The transaction this flow's reads run on: the one the scope names, while
 * it is still open in the flow; undefined outside the scope, or once it has
 * ended. The adapter is asked only inside the scope, so a service outside it
 * pays one store lookup.
 */
function readTransactionOf(
  adapter: Pick<DrizzleAdapter, "transactionOpenInFlow">
): TransactionContext | undefined {
  const scope = readTransaction.getStore();
  return scope !== undefined && scope.live && adapter.transactionOpenInFlow()
    ? scope.tx
    : undefined;
}

/** The views handed out, per adapter and transaction, so each is built once. */
const views = new WeakMap<
  DrizzleAdapter,
  WeakMap<TransactionContext, DrizzleAdapter>
>();

/** The adapter behind each view. */
const viewed = new WeakMap<object, DrizzleAdapter>();

/**
 * The adapter itself, when `adapter` is one of the views
 * {@link adapterForReads} hands out; `adapter` otherwise. A service built
 * inside the scope from another's adapter (a sub-service made on first use)
 * keeps the adapter, not a view of one transaction.
 */
export function pooledAdapterOf(adapter: DrizzleAdapter): DrizzleAdapter {
  return viewed.get(adapter) ?? adapter;
}

/**
 * The database connection `value` stands for, as a cache keyed by
 * connection should key it: the adapter behind a view, or `value` itself. A
 * verdict observed through the pool then serves a read routed to a
 * transaction, and the other way round.
 */
export function connectionOf(value: object): object {
  return viewed.get(value) ?? value;
}

/** Whether `value` is a view reading on a transaction (see {@link adapterForReads}). */
export function readsOnTransaction(value: object): boolean {
  return viewed.has(value);
}

/** The transaction each view reads on. */
const viewTransactions = new WeakMap<object, TransactionContext>();

/**
 * The executor a read made through `value` runs on at this call, when
 * `value` is a view whose reads run on its transaction
 * ({@link readsOnTransaction}) and its scope is still the calling flow's:
 * that transaction's own Drizzle handle. Undefined for an adapter, or a view
 * kept past its scope's end, whose reads reach the pool.
 */
export function readExecutorOfView(value: object): unknown {
  const adapter = viewed.get(value);
  const tx = viewTransactions.get(value);
  return adapter !== undefined &&
    tx !== undefined &&
    readTransactionOf(adapter) === tx
    ? tx.getDrizzle()
    : undefined;
}

/**
 * The adapter a service reads through: `adapter` itself, or inside
 * {@link runReadsInTransaction} a view of it whose reads run on the scope's
 * transaction.
 */
export function adapterForReads(adapter: DrizzleAdapter): DrizzleAdapter {
  const tx = readTransactionOf(adapter);
  if (tx === undefined) return adapter;
  let byTransaction = views.get(adapter);
  if (byTransaction === undefined) {
    byTransaction = new WeakMap();
    views.set(adapter, byTransaction);
  }
  let view = byTransaction.get(tx);
  if (view === undefined) {
    view = readingOn(adapter, tx);
    byTransaction.set(tx, view);
    viewed.set(view, adapter);
    viewTransactions.set(view, tx);
  }
  return view;
}

/**
 * `adapter`, with each method that reads through the pool answered on `tx`.
 *
 * A method that takes an executor is handed the transaction's, unless the
 * caller named one. Everything else is the adapter's own, bound to it: its
 * protected state, its private fields and its transaction tracking stay
 * where they are.
 *
 * Each routed method asks again, at the call, whether this flow still reads
 * on `tx`, and is the adapter's own when it does not. A view that outlives
 * its scope (kept by code that caches what it was handed) then reads on the
 * pool, as the adapter would, rather than on a transaction that has ended.
 */
function readingOn(
  adapter: DrizzleAdapter,
  tx: TransactionContext
): DrizzleAdapter {
  const live = (): TransactionContext | undefined =>
    readTransactionOf(adapter) === tx ? tx : undefined;
  const executorFor = (executor: unknown): unknown =>
    executor ?? live()?.getDrizzle();
  // A write runs on `tx` only inside a scope that routes writes too
  // (`runReadsAndWritesInTransaction`); a read-only scope leaves it pooled.
  const writingOn = (): TransactionContext | undefined =>
    readTransaction.getStore()?.writes === true ? live() : undefined;
  const writeExecutorFor = (executor: unknown): unknown =>
    executor ?? writingOn()?.getDrizzle();
  const routed = {
    getDrizzle: <T = unknown>(relations?: AnyRelations): T => {
      const on = live();
      if (on === undefined) return adapter.getDrizzle<T>(relations);
      return relations === undefined
        ? on.getDrizzle<T>()
        : on.drizzleWithRelations<T>(relations);
    },
    select: <T = unknown>(
      table: string,
      options?: SelectOptions,
      executor?: unknown
    ): Promise<T[]> => adapter.select<T>(table, options, executorFor(executor)),
    selectOne: <T = unknown>(
      table: string,
      options?: SelectOptions,
      executor?: unknown
    ): Promise<T | null> =>
      adapter.selectOne<T>(table, options, executorFor(executor)),
    count: (
      table: string,
      options?: CountOptions,
      executor?: unknown
    ): Promise<number> => adapter.count(table, options, executorFor(executor)),
    executeQuery: <T = unknown>(
      sql: string,
      params?: SqlParam[]
    ): Promise<T[]> => {
      const on = live();
      return on === undefined
        ? adapter.executeQuery<T>(sql, params)
        : on.execute<T>(sql, params);
    },
    queryStatement: <T = Record<string, unknown>>(
      statement: SQL
    ): Promise<T[]> => {
      const on = live();
      return on === undefined
        ? adapter.queryStatement<T>(statement)
        : on.queryStatement<T>(statement);
    },
    tableExists: (tableName: string, schema?: string): Promise<boolean> => {
      const on = live();
      return on === undefined
        ? adapter.tableExists(tableName, schema)
        : adapter.tableExistsThrough(on, tableName, schema);
    },
    listTables: (schema?: string): Promise<string[]> => {
      const on = live();
      return on === undefined
        ? adapter.listTables(schema)
        : adapter.listTablesThrough(on, schema);
    },
    // The writes, routed only in a scope that asks for it. The two inserts
    // take no executor, so they run through the transaction's own.
    insert: <T = unknown>(
      table: string,
      data: Record<string, unknown>,
      options?: InsertOptions
    ): Promise<T> => {
      const on = writingOn();
      return on === undefined
        ? adapter.insert<T>(table, data, options)
        : on.insert<T>(table, data, options);
    },
    insertMany: <T = unknown>(
      table: string,
      data: Record<string, unknown>[],
      options?: InsertOptions
    ): Promise<T[]> => {
      const on = writingOn();
      return on === undefined
        ? adapter.insertMany<T>(table, data, options)
        : on.insertMany<T>(table, data, options);
    },
    update: <T = unknown>(
      table: string,
      data: Record<string, unknown>,
      where: WhereClause,
      options?: UpdateOptions,
      executor?: unknown
    ): Promise<T[]> =>
      adapter.update<T>(
        table,
        data,
        where,
        options,
        writeExecutorFor(executor)
      ),
    updateCount: (
      table: string,
      data: Record<string, unknown>,
      where: WhereClause,
      executor?: unknown
    ): Promise<number> =>
      adapter.updateCount(table, data, where, writeExecutorFor(executor)),
    delete: (
      table: string,
      where: WhereClause,
      options?: DeleteOptions,
      executor?: unknown
    ): Promise<number> =>
      adapter.delete(table, where, options, writeExecutorFor(executor)),
    upsert: <T = unknown>(
      table: string,
      data: Record<string, unknown>,
      options: UpsertOptions,
      executor?: unknown
    ): Promise<T> =>
      adapter.upsert<T>(table, data, options, writeExecutorFor(executor)),
  } satisfies Partial<DrizzleAdapter>;
  return new Proxy(adapter, {
    get(target, property) {
      if (Object.hasOwn(routed, property)) {
        return routed[property as keyof typeof routed];
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/**
 * The row lock a read of content rows made here takes: inside
 * {@link runReadsInTransaction}, on a dialect with row locks, unless the
 * scope asked for none. Undefined where no lock is taken. The one place that
 * decides it, for the reads built here and the adapter's `forShare`.
 */
function rowLockOf(adapter: ReadingAdapter): ReadLockStrength | undefined {
  if (readTransactionOf(adapter) === undefined) return undefined;
  if (adapter.getCapabilities().dialect === "sqlite") return undefined;
  const lock = readTransaction.getStore()?.lock ?? "share";
  return lock === "none" ? undefined : lock;
}

/**
 * Whether a read of content rows made here takes a row lock
 * ({@link rowLockOf}).
 *
 * A locking read sees the latest committed row rather than the
 * transaction's snapshot, which under MySQL's REPEATABLE READ is what a
 * plugin that took a lock row before reading relies on, and it holds the rows
 * it read until the transaction ends. SQLite has one writer and one
 * connection, so its reads already see the latest commit and nothing can
 * change a row under them; it has no row lock to take.
 *
 * Only row reads lock. An aggregate (a list's total) cannot take `FOR SHARE`
 * on PostgreSQL, so it is read as before and holds nothing.
 */
export function readLocksRows(adapter: ReadingAdapter): boolean {
  return rowLockOf(adapter) !== undefined;
}

/** The select builder's locking clause, as PostgreSQL's and MySQL's take it. */
interface LockableSelect {
  for(strength: ReadLockStrength, config?: { of: unknown }): unknown;
}

/**
 * `query` with the scope's lock (shared, or for update) on the rows it reads
 * from `table` when {@link rowLockOf} names one, otherwise `query` unchanged:
 * outside the scope, on SQLite, or for a scope that asked for none. Applied last,
 * after the limit and offset, as the locking clause ends the statement.
 *
 * On PostgreSQL the lock names `table`: a read joined to a translations table
 * must not lock that side, which PostgreSQL refuses for the nullable side of
 * an outer join. MySQL's clause names no table, and locks the joined rows it
 * read as well.
 */
export function lockedForRead<Q>(
  query: Q,
  adapter: ReadingAdapter,
  table: unknown
): Q {
  const strength = rowLockOf(adapter);
  if (strength === undefined) return query;
  const lockable = query as unknown as LockableSelect;
  return (
    adapter.getCapabilities().dialect === "postgresql"
      ? lockable.for(strength, { of: table })
      : lockable.for(strength)
  ) as Q;
}
