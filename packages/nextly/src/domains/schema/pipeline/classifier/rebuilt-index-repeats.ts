/**
 * The rows a SQLite unique index of several columns would hold the same values in once its table is
 * rebuilt with new column types.
 *
 * SQLite's rebuild copies each stored value into the new table, where the new column's type decides
 * how it is kept: the texts "1" and " 1" become the one integer 1 in an integer column, and a text
 * that is no number stays as it is. The index is made after the copy, so two rows that become one
 * set of values end the apply with the table already rebuilt. What the copy keeps is SQLite's own
 * rule, so SQLite is asked, not imitated: the index's values are copied into a temporary table with
 * the new types, and SQLite groups the repeats there. Nothing is held in memory, and every row is
 * compared, a value to be cleared included, since it is copied and indexed before it is cleared.
 *
 * @module domains/schema/pipeline/classifier/rebuilt-index-repeats
 */
import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../../../errors/nextly-error";
import type { RowKey } from "../../value-conversion/types";
import { runStatement } from "../_internal/run-statement";

import { querySqlRows } from "./count-helpers";

/** One column of the index: its name in the live table and its type once the table is rebuilt. */
export interface IndexedColumn {
  column: string;
  type: string;
}

/** A declared column type: a name, and at most a length or a precision and scale. */
const DECLARED_TYPE = /^[A-Za-z][A-Za-z0-9_ ]*(\(\s*\d+\s*(,\s*\d+\s*)?\))?$/;

/**
 * The rows of `table`, keyed by `id`, whose values in `columns` repeat another row's once each is
 * kept as its new type: the first `bound` of them by id, and how many there are. A row with no
 * value in one of the columns repeats nothing, as a unique index holds.
 */
export async function rebuiltIndexRepeats(
  db: unknown,
  table: string,
  columns: readonly IndexedColumn[],
  bound: number
): Promise<{ first: RowKey[]; count: number }> {
  for (const { type } of columns) {
    // The type is written into the statement as it is: only a type's shape is let through.
    if (!DECLARED_TYPE.test(type)) {
      throw NextlyError.internal({
        logContext: {
          reason: "unexpected-column-type-under-unique-index",
          table,
          type,
        },
      });
    }
  }
  const scratch = sql.identifier(
    `nextly_index_repeats_${String(process.pid)}_${String(Date.now())}`
  );
  const named = columns.map((_, i) => sql.identifier(`c${String(i)}`));
  const tuple = sql.join(named, sql`, `);
  const kept = sql.join(
    columns.map(({ type }, i) => sql`${named[i]} ${sql.raw(type)}`),
    sql`, `
  );
  const held = sql.join(
    named.map(name => sql`${name} IS NOT NULL`),
    sql` AND `
  );
  const repeats: SQL = sql`(${tuple}) IN (SELECT ${tuple} FROM ${scratch} WHERE ${held} GROUP BY ${tuple} HAVING COUNT(*) > 1)`;
  await runStatement(
    db,
    "sqlite",
    sql`CREATE TEMP TABLE ${scratch} (k TEXT, ${kept})`
  );
  try {
    await runStatement(
      db,
      "sqlite",
      sql`INSERT INTO ${scratch} SELECT CAST(id AS TEXT), ${sql.join(
        columns.map(({ column }) => sql.identifier(column)),
        sql`, `
      )} FROM ${sql.identifier(table)}`
    );
    const [counted] = await querySqlRows<{ n: unknown }>(
      db,
      "sqlite",
      sql`SELECT COUNT(*) AS n FROM ${scratch} WHERE ${repeats}`
    );
    const first = await querySqlRows<{ k: unknown }>(
      db,
      "sqlite",
      sql`SELECT k FROM ${scratch} WHERE ${repeats} ORDER BY k LIMIT ${bound}`
    );
    return {
      first: first.map(row => ({ id: String(row.k) })),
      count: Number(counted?.n ?? 0),
    };
  } finally {
    await runStatement(db, "sqlite", sql`DROP TABLE IF EXISTS ${scratch}`);
  }
}
