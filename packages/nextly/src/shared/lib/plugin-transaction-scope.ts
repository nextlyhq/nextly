/**
 * Whether the current async call chain runs inside a plugin's
 * `ctx.db.transaction`.
 *
 * On SQLite a plugin's transaction holds the database's only connection, so a
 * service called inside it joins it as a savepoint, and the plugin can still
 * roll it back after the service has finished. A service whose side effects
 * outside the database cannot be undone by that rollback (deleting stored
 * media files) asks this to tell a plugin's transaction from core's own
 * enclosing transactions, whose work it already accounts for.
 *
 * `AsyncLocalStorage` rather than a module flag: requests are served
 * concurrently, and only the plugin work's own call chain is inside the
 * transaction.
 *
 * @module shared/lib/plugin-transaction-scope
 */
import { AsyncLocalStorage } from "node:async_hooks";

const pluginTransaction = new AsyncLocalStorage<true>();

/** Run `work` marked as running inside a plugin's `ctx.db.transaction`. */
export function runInPluginTransaction<T>(work: () => Promise<T>): Promise<T> {
  return pluginTransaction.run(true, work);
}

/** True while the caller runs inside a plugin's `ctx.db.transaction`. */
export function inPluginTransaction(): boolean {
  return pluginTransaction.getStore() === true;
}
