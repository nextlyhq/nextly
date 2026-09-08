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

import type {
  DeleteOptions,
  SelectOptions,
  TransactionContext,
  UpdateOptions,
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
  update<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    where: WhereClause,
    options?: UpdateOptions,
    executor?: unknown
  ): Promise<T[]>;
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
 */
export type TransactionCrudForwarders = Pick<
  TransactionContext,
  | "select"
  | "selectOne"
  | "update"
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

    update: async <T = unknown>(
      table: string,
      data: Record<string, unknown>,
      where: WhereClause,
      options?: UpdateOptions
    ): Promise<T[]> => {
      return delegator.update<T>(table, data, where, options, txDb());
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
