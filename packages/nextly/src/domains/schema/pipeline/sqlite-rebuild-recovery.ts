/**
 * A SQLite table rebuild interrupted part-way, finished or undone before the next apply.
 *
 * SQLite applies a schema change without a transaction (foreign keys are switched off around the
 * apply, which a transaction would not allow), so a table rebuild can stop between its steps:
 * copy the table into `__new_<table>`, drop `<table>`, rename the copy. The next apply would meet
 * the copy as a table of its own and rebuild into it again, which fails. Two states can be left,
 * and each has one way back:
 *
 * - **Both tables there:** the rebuild stopped before it dropped the original, which still holds
 *   every row, so the copy is dropped.
 * - **Only the copy there:** it stopped between the drop and the rename, so the copy holds every
 *   row and takes the table's name.
 *
 * Asked before the apply reads the live schema, and only of the tables the desired schema
 * manages, while the caller holds the schema lock, so no rebuild is in flight beside it.
 *
 * @module domains/schema/pipeline/sqlite-rebuild-recovery
 */
import { sql } from "drizzle-orm";

import { runStatement } from "./_internal/run-statement";

/** The prefix a SQLite table rebuild names its copy with. */
const REBUILD_COPY_PREFIX = "__new_";

interface SqliteAll {
  all(query: unknown): unknown[] | Promise<unknown[]>;
}

/**
 * Put back every managed table an interrupted rebuild left in two, on a SQLite database.
 *
 * @returns what was done, one line per table, for the caller's log
 */
export async function recoverInterruptedSqliteRebuilds(
  db: unknown,
  managedTables: ReadonlySet<string>
): Promise<string[]> {
  const rows = (await (db as SqliteAll).all(
    sql`SELECT name FROM sqlite_master WHERE type = 'table'`
  )) as Array<{ name: string }>;
  const present = new Set(rows.map(row => row.name));
  const done: string[] = [];
  for (const name of present) {
    if (!name.startsWith(REBUILD_COPY_PREFIX)) continue;
    const table = name.slice(REBUILD_COPY_PREFIX.length);
    if (!managedTables.has(table)) continue;
    if (present.has(table)) {
      await runStatement(db, "sqlite", sql`DROP TABLE ${sql.identifier(name)}`);
      done.push(`dropped ${name}, a copy of ${table} its rebuild never used`);
    } else {
      await runStatement(
        db,
        "sqlite",
        sql`ALTER TABLE ${sql.identifier(name)} RENAME TO ${sql.identifier(table)}`
      );
      done.push(`renamed ${name} to ${table}, as its rebuild was about to`);
    }
  }
  return done;
}
