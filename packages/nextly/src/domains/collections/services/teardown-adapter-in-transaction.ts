/**
 * The adapter a collection's delete tears down through, bound to one
 * transaction.
 *
 * The teardown helpers (field-group values, translations) take an adapter and
 * run every statement through it. Handed the adapter itself, each statement
 * commits on its own, so a delete of several collections that fails on the
 * second has already removed the first one's values and translations. Handed
 * this, every statement runs on the transaction's own connection, so the
 * delete commits whole or, where the database undoes a table drop (PostgreSQL
 * and SQLite), not at all.
 *
 * Every member reaches the database through `tx`, catalogue reads included:
 * asking the pool from inside the transaction would wait, on a pool of one,
 * for the connection the transaction holds, and on SQLite's one connection
 * for the transaction itself.
 *
 * @module domains/collections/services/teardown-adapter-in-transaction
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SqlParam,
  TransactionContext,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";

import { resolveRelations } from "../../../database/resolve-relations";
import type { TeardownComponentDataAdapter } from "../../field-groups/services/teardown-entity-field-group-data";
import type { TeardownI18nAdapter } from "../../i18n/migration/teardown-entity-i18n";

/**
 * What both teardown helpers drive. `getCapabilities` too: forgetting a
 * translation transition builds a `MetaService` on the adapter it is given,
 * and that service reads its dialect from it.
 */
export type TeardownAdapter = TeardownComponentDataAdapter &
  TeardownI18nAdapter &
  Pick<DrizzleAdapter, "getCapabilities">;

/**
 * `adapter`'s teardown surface, every statement run inside `tx`.
 *
 * A new object, not the adapter: anything the helpers remember against the
 * adapter they are given is remembered against this one and dies with it, so
 * the caller forgets, against the adapter itself, what the committed delete
 * removed.
 */
export function teardownAdapterIn(
  adapter: DrizzleAdapter,
  tx: TransactionContext
): TeardownAdapter {
  const catalog = {
    execute: <T = unknown>(statement: string, params?: SqlParam[]) =>
      tx.execute<T>(statement, params),
  };
  return {
    dialect: adapter.dialect,
    // Static flags of the database, the same inside the transaction.
    getCapabilities() {
      return adapter.getCapabilities();
    },
    executeQuery<T = unknown>(statement: string, params?: SqlParam[]) {
      return tx.execute<T>(statement, params);
    },
    select<T = Record<string, unknown>>(
      table: string,
      options: { where?: WhereClause }
    ) {
      return tx.select<T>(table, options);
    },
    delete(table: string, where: WhereClause) {
      return tx.delete(table, where);
    },
    getDrizzle<T = unknown>(): T {
      return tx.drizzleWithRelations<T>(resolveRelations(adapter.dialect));
    },
    tableExists(tableName: string) {
      return adapter.tableExistsThrough(catalog, tableName);
    },
    listTables() {
      return adapter.listTablesThrough(catalog);
    },
  };
}
