/**
 * One SQLite transaction around a run of schema statements that move a translatable column off its
 * main table. SQLite's schema statements are transactional, so one it refuses part-way (a column
 * drop a view or a trigger still names) leaves nothing applied, rather than the columns dropped
 * before it gone and the entity half moved.
 *
 * Opened through the adapter's own transaction scope (`transaction`), never a raw `SAVEPOINT`: the
 * adapter then knows a transaction is open, queues every other transaction behind it, and joins one
 * a caller already holds as a savepoint, so no unrelated work runs inside it or is rolled back with
 * it. The statements of `run` go to the same connection and so into it. Every other dialect runs
 * `run` as it is.
 *
 * @module domains/i18n/migration/sqlite-transaction
 */

/**
 * What the scope needs of an adapter: its dialect, and its transaction scope. An adapter offering
 * none (a narrowed test double) runs `run` as it is.
 */
interface TransactionScopeAdapter {
  dialect: string;
  transaction?<T>(work: (tx: unknown) => Promise<T>): Promise<T>;
}

/** Runs `run` in one transaction of the adapter on SQLite, rolled back whole where it throws. */
export function inOneSqliteTransaction<T>(
  adapter: TransactionScopeAdapter,
  run: () => Promise<T>
): Promise<T> {
  if (adapter.dialect !== "sqlite" || !adapter.transaction) return run();
  return adapter.transaction(() => run());
}
