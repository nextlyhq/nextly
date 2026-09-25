/**
 * Transaction CRUD forwarder helper for database adapters.
 *
 * @remarks
 * Encapsulates the delegation pattern where a transaction context forwards its
 * CRUD methods to the adapter's implementation while passing the transaction-bound
 * Drizzle executor.
 *
 * @packageDocumentation
 */

import type { AnyRelations } from "drizzle-orm";

import type {
  DeleteOptions,
  SelectOptions,
  TransactionContext,
  UpsertOptions,
  WhereClause,
} from "./types";

/**
 * Interface representing an adapter that can execute CRUD operations with an optional executor.
 */
export interface TransactionCrudDelegator {
  select<T = unknown>(
    table: string,
    options?: SelectOptions,
    executor?: unknown
  ): Promise<T[]>;
  selectOne<T = unknown>(
    table: string,
    options?: SelectOptions,
    executor?: unknown
  ): Promise<T | null>;
  updateCount(
    table: string,
    data: Record<string, unknown>,
    where: WhereClause,
    executor?: unknown
  ): Promise<number>;
  delete(
    table: string,
    where: WhereClause,
    options?: DeleteOptions,
    executor?: unknown
  ): Promise<number>;
  upsert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    options: UpsertOptions,
    executor?: unknown
  ): Promise<T>;
}

/**
 * Transaction context CRUD methods provided by the forwarder.
 *
 * `update` is not among them. The pooled `update` goes through the Drizzle
 * query builder, which writes the columns the runtime model declares; a
 * transaction's update must reach the columns the physical table has, and
 * each adapter binds the base class's `transactionUpdate` beside its
 * transactional `insert`.
 */
export type TransactionCrudForwarders = Pick<
  TransactionContext,
  | "select"
  | "selectOne"
  // The fenced compare-and-set. Listed explicitly like every other key here:
  // the type is DERIVED from `TransactionContext` in the sense that its
  // signatures come from there, but the key set is enumerated, so a method
  // added to the context is not forwarded until it is named here too.
  | "updateCount"
  | "delete"
  | "upsert"
  | "getDrizzle"
>;

/**
 * Create CRUD and Drizzle instance forwarding methods for a TransactionContext.
 *
 * @remarks
 * TransactionContext delegates its CRUD methods to the adapter's Drizzle CRUD
 * implementation while binding the transaction executor so queries run inside
 * the transaction rather than on the connection pool.
 *
 * @param delegator - Object providing the underlying adapter CRUD methods
 * @param txDb - Thunk returning the transaction-bound Drizzle instance
 * @returns Object with forwarded TransactionContext methods
 */
export function createTransactionForwarders(
  delegator: TransactionCrudDelegator,
  txDb: () => unknown
): TransactionCrudForwarders {
  return {
    select: async <T = unknown>(
      table: string,
      options?: SelectOptions
    ): Promise<T[]> => {
      return delegator.select<T>(table, options, txDb());
    },

    selectOne: async <T = unknown>(
      table: string,
      options?: SelectOptions
    ): Promise<T | null> => {
      return delegator.selectOne<T>(table, options, txDb());
    },

    updateCount: async (
      table: string,
      data: Record<string, unknown>,
      where: WhereClause
    ): Promise<number> => {
      return delegator.updateCount(table, data, where, txDb());
    },

    delete: async (
      table: string,
      where: WhereClause,
      options?: DeleteOptions
    ): Promise<number> => {
      return delegator.delete(table, where, options, txDb());
    },

    upsert: async <T = unknown>(
      table: string,
      data: Record<string, unknown>,
      options: UpsertOptions
    ): Promise<T> => {
      return delegator.upsert<T>(table, data, options, txDb());
    },

    getDrizzle: <T = unknown>(): T => txDb() as T,
  };
}

/**
 * The Drizzle handles one transaction hands out, built once each.
 *
 * `bare` is `TransactionContext.drizzle()`, the instance the delegated CRUD
 * runs on. `withRelations(relations)` is `drizzleWithRelations`: an instance
 * on the SAME connection whose `query` namespace is populated, so relational
 * reads stay inside the transaction. Both are built lazily — a transaction
 * using only raw execute never constructs one — and the relational ones are
 * memoized per relations object, exactly as `getDrizzle()` memoizes its
 * pooled ones.
 *
 * Shared because the three adapters differ only in how they build an
 * instance on their connection, which is what `build` supplies.
 */
export function transactionDrizzleHandles<TBare>(
  build: (relations?: AnyRelations) => TBare
): {
  bare: () => TBare;
  withRelations: <T = unknown>(relations: AnyRelations) => T;
  /** The two `TransactionContext` members, ready to spread into one. */
  context: Pick<TransactionContext, "drizzle" | "drizzleWithRelations">;
} {
  let bareInstance: TBare | undefined;
  const bare = (): TBare => (bareInstance ??= build());
  const relational = new WeakMap<AnyRelations, TBare>();
  const withRelations = <T = unknown>(relations: AnyRelations): T => {
    let cached = relational.get(relations);
    if (cached === undefined) {
      cached = build(relations);
      relational.set(relations, cached);
    }
    return cached as unknown as T;
  };
  return {
    bare,
    withRelations,
    context: {
      drizzle: <T = unknown>(): T => bare() as unknown as T,
      drizzleWithRelations: withRelations,
    },
  };
}
