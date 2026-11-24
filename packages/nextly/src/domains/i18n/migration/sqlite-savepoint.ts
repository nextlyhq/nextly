/**
 * One SQLite savepoint around a run of schema statements that move a translatable column off its
 * main table. SQLite's schema statements are transactional, so one it refuses part-way (a column
 * drop a view or a trigger still names) leaves nothing applied, rather than the columns dropped
 * before it gone and the entity half moved. A savepoint rather than `BEGIN`, so it nests inside a
 * transaction a caller holds. Every other dialect runs `run` as it is.
 *
 * @module domains/i18n/migration/sqlite-savepoint
 */

/** What the savepoint needs of an adapter: its dialect, and one statement at a time. */
interface SavepointAdapter {
  dialect: string;
  executeQuery(statement: string): Promise<unknown>;
}

/** Runs `run` inside the savepoint `name` on SQLite, rolled back whole where it throws. */
export async function inOneSqliteSavepoint<T>(
  adapter: SavepointAdapter,
  name: string,
  run: () => Promise<T>
): Promise<T> {
  if (adapter.dialect !== "sqlite") return run();
  await adapter.executeQuery(`SAVEPOINT "${name}"`);
  let result: T;
  try {
    result = await run();
  } catch (error) {
    await adapter.executeQuery(`ROLLBACK TO SAVEPOINT "${name}"`);
    await adapter.executeQuery(`RELEASE SAVEPOINT "${name}"`);
    throw error;
  }
  await adapter.executeQuery(`RELEASE SAVEPOINT "${name}"`);
  return result;
}
