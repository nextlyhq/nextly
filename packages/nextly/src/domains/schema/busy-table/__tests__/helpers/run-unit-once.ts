/**
 * `runUnitInTries` as one try that never meets a busy table, for suites that drive a Schema Builder
 * save through an adapter double and judge the statements the save hands over and the outcome it
 * records, not how it waits.
 *
 * A Builder save runs its statements through the busy-table runner, which reads the trigger
 * catalog, opens a session of its own, bounds it with the dialect's lock settings and watches it
 * from a second connection. A double modelling all of that would be a second, untested database;
 * one missing any of it makes every save look refused. The tries themselves are judged against
 * real databases (`busy-table-parity.integration.test.ts` and the other `busy-table-*`
 * integration suites); this stands in for them with what one try that never waits does:
 *
 * - each statement is sent once, in order, through the adapter's `executeQuery`, where the double
 *   records it;
 * - a failure the caller passes over (`BusyTableRun.passOver`) is passed over only where the
 *   runner would: outside a transaction, or on MySQL, which rolls back the statement alone;
 * - anything else fails the unit, as the runner's last try does;
 * - `after` runs once every statement has, with the count, as the runner runs it.
 *
 * Wire it with `vi.mock` over `busy-table/run-unit`, keeping the module's other exports.
 */
import type { runUnitInTries } from "../../run-unit";

export const runUnitOnce: typeof runUnitInTries = async (
  adapter,
  statements,
  unit,
  after,
  run
) => {
  const dialect = adapter.getCapabilities().dialect;
  // As `runMigrationStatements`: in a transaction, only MySQL can go on past a failed statement.
  const mayPassOver = !unit.transaction || dialect === "mysql";
  for (const statement of statements) {
    try {
      await adapter.executeQuery(statement);
    } catch (error) {
      if (mayPassOver && run.passOver?.(error, statement) === true) continue;
      throw error;
    }
  }
  await after(adapter.getDrizzle(), statements.length);
  return statements.length;
};
