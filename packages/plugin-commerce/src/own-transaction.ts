import type {
  PluginDatabase,
  PluginTransaction,
} from "@nextlyhq/plugin-sdk/schema";

/**
 * Run a write that needs no other statement beside it in a transaction of
 * its own.
 *
 * On SQLite every query of the process shares one connection, and only
 * `transaction()` calls queue behind each other: a statement issued outside
 * one, while another chain's transaction is open, runs inside that
 * transaction, and is undone with it if it rolls back, though its own caller
 * already saw it succeed. Commerce's writes outside a transaction (a step's
 * claim and outcome, a payment's start recorded, a job's run) are made this
 * way so they queue instead. On PostgreSQL and MySQL each transaction has a
 * connection of its own, and this costs one round trip.
 */
export function ownTransaction<T>(
  db: PluginDatabase,
  write: (tx: PluginTransaction) => Promise<T>
): Promise<T> {
  return db.transaction(write);
}
