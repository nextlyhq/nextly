/**
 * The drop of an older unique index a field that stops being unique leaves holding its column.
 *
 * A migration file is written from snapshots, which record the unique index Nextly declares for a
 * unique field and nothing else. An older table can also hold the column unique under a name
 * Nextly did not make (`posts_code_key UNIQUE(code)`). A file that drops only Nextly's own index
 * leaves the column unique on every database it runs on, while the field says it is not. So where
 * the database the file is written against holds such an index, the file drops it too, by name and
 * only where an index of that name stands when it runs: PostgreSQL's and SQLite's drops say
 * `IF EXISTS`, MySQL's is built from its catalog (`guardedIndexDrop`). A database whose older index
 * has another name keeps it; the file cannot know that name.
 *
 * Read from the database only for a column that stops being unique, so every other run stays
 * offline. The push drops the same index on the database it runs on (`dropUniquenessLeftOn`).
 *
 * @module domains/schema/migrate-create/leftover-unique-indexes
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { DropIndexOp, Operation, TableSpec } from "../pipeline/diff/types";
import { generateStatements } from "../pipeline/sql-templates/index";
import { guardedIndexDrop } from "../pipeline/sql-templates/mysql-live-restate";

/**
 * Every index holding a column of `tableName` unique on its own, by the column, each by its name
 * (null where no statement drops it by name), as the database the file is written against has
 * them (`readUniqueIndexesByColumn`); undefined where that database cannot be read.
 */
export type LiveUniqueIndexes = (
  tableName: string
) => Promise<ReadonlyMap<string, readonly (string | null)[]> | undefined>;

/** An older unique index the file drops, for the run to name. */
export interface LeftoverUniqueIndex {
  table: string;
  column: string;
  index: string;
}

/**
 * The drops of Nextly's own unique index for a column that stays in its table and is no longer
 * held unique there: a field that stops being unique. A column the table drops or renames, or
 * still holds unique by an index it declares, is not one.
 */
function uniqueStopping(
  operations: readonly Operation[],
  desired: readonly TableSpec[]
): DropIndexOp[] {
  return operations.filter((op): op is DropIndexOp => {
    if (op.type !== "drop_index") return false;
    if (!op.index.unique || op.index.columns.length !== 1) return false;
    const column = op.index.columns[0];
    const table = desired.find(spec => spec.name === op.tableName);
    if (table === undefined) return false;
    if (!table.columns.some(spec => spec.name === column)) return false;
    return !(table.indexes ?? []).some(
      index =>
        index.unique &&
        index.columns.length === 1 &&
        index.columns[0] === column
    );
  });
}

/** The statements that drop `index` on `table` only where it stands. */
function guardedDrop(
  dialect: SupportedDialect,
  table: string,
  column: string,
  index: string
): string[] {
  if (dialect === "mysql") return guardedIndexDrop(table, index);
  // PostgreSQL's and SQLite's drops of a unique index already say IF EXISTS; PostgreSQL's drops it
  // as a constraint, which `UNIQUE (code)` makes, and as an index, which `CREATE UNIQUE INDEX` does.
  return generateStatements(
    [
      {
        type: "drop_index",
        tableName: table,
        index: { name: index, columns: [column], unique: true },
      },
    ],
    dialect,
    []
  );
}

/**
 * The file's statements that drop each older unique index left holding a column whose field stops
 * being unique, and those indexes, for the run to name: the file may drop one the user made. A
 * table that cannot be read is said to `warn`, with what to drop by hand if there is such an index.
 */
export async function leftoverUniqueDrops(args: {
  operations: readonly Operation[];
  desired: readonly TableSpec[];
  dialect: SupportedDialect;
  read: LiveUniqueIndexes | undefined;
  warn: (message: string) => void;
}): Promise<{ statements: string[]; dropped: LeftoverUniqueIndex[] }> {
  const statements: string[] = [];
  const dropped: LeftoverUniqueIndex[] = [];
  const stopping = uniqueStopping(args.operations, args.desired);
  if (stopping.length === 0 || args.read === undefined) {
    return { statements, dropped };
  }
  const read = new Map<
    string,
    Promise<ReadonlyMap<string, readonly (string | null)[]> | undefined>
  >();
  for (const op of stopping) {
    const column = op.index.columns[0];
    if (!read.has(op.tableName))
      read.set(op.tableName, args.read(op.tableName));
    const live = await read.get(op.tableName);
    if (live === undefined) {
      args.warn(
        `Could not read ${op.tableName} to look for another unique index on ${column}. ` +
          `If one holds ${column} unique under a name Nextly did not make, drop it by hand: ` +
          `this migration drops only ${op.index.name}.`
      );
      continue;
    }
    const own = op.index.name.toLowerCase();
    for (const name of live.get(column) ?? []) {
      // No name: the primary key, or SQLite's index for an inline UNIQUE, which no statement drops.
      if (name === null || name.toLowerCase() === own) continue;
      statements.push(...guardedDrop(args.dialect, op.tableName, column, name));
      dropped.push({ table: op.tableName, column, index: name });
    }
  }
  return { statements, dropped };
}

/** What a run says of an older unique index its file drops. */
export function leftoverUniqueNotice(dropped: LeftoverUniqueIndex): string {
  return (
    `Drops the unique index ${dropped.index} on ${dropped.table}(${dropped.column}) as well as ` +
    `Nextly's own: ${dropped.column} is no longer unique, and that index still holds it so. ` +
    `Nextly did not name it, so it may be one you made. It is dropped only where it exists.`
  );
}
