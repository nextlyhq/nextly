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
 * Asked before the apply reads the live schema, while the caller holds the schema lock, so no
 * rebuild is in flight beside it. The name alone proves nothing, since a project or a plugin can
 * own a table called `__new_<table>`, so a copy is recovered only when its columns are exactly
 * the ones the managed table is meant to have, which is what a rebuild of it creates. Any other
 * table is left as it is.
 *
 * @module domains/schema/pipeline/sqlite-rebuild-recovery
 */
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";

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
  /** Each managed table this may recover, with the columns it is meant to have. */
  expectedColumns: ReadonlyMap<string, ReadonlySet<string>>
): Promise<string[]> {
  const rows = (await (db as SqliteAll).all(
    sql`SELECT name FROM sqlite_master WHERE type = 'table'`
  )) as Array<{ name: string }>;
  const present = new Set(rows.map(row => row.name));
  const done: string[] = [];
  for (const name of present) {
    if (!name.startsWith(REBUILD_COPY_PREFIX)) continue;
    const table = name.slice(REBUILD_COPY_PREFIX.length);
    const expected = expectedColumns.get(table);
    if (expected === undefined) continue;
    if (!sameColumns(await columnsOf(db, name), expected)) {
      // Beside its table, another owner's table: left alone. In place of it, it may hold the
      // table's rows under another shape, and going on would have the push create the table
      // empty beside them, so the apply stops, naming it.
      if (!present.has(table)) {
        throw new NextlyError({
          code: "NEXTLY_MIGRATION_APPLY_FAILED",
          publicMessage:
            `This change was not applied, because the table "${table}" is missing and a table ` +
            `"${name}" stands in its place with other columns. It may hold that table's rows ` +
            `from a change stopped part-way. Restore or remove it, then save again.`,
          logContext: { table, copy: name },
        });
      }
      continue;
    }
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

/** The column names a SQLite table has. */
async function columnsOf(db: unknown, table: string): Promise<Set<string>> {
  const rows = (await (db as SqliteAll).all(
    sql`SELECT name FROM pragma_table_info(${table})`
  )) as Array<{ name: string }>;
  return new Set(rows.map(row => row.name));
}

function sameColumns(
  actual: ReadonlySet<string>,
  expected: ReadonlySet<string>
): boolean {
  return (
    actual.size === expected.size && [...expected].every(c => actual.has(c))
  );
}
