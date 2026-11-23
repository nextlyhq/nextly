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

import type {
  DropIndexOp,
  Operation,
  RenameColumnOp,
  TableSpec,
} from "../pipeline/diff/types";
import { canQuoteIdent } from "../pipeline/sql-templates/identifier-quoting";
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
 * held unique there: a field that stops being unique. The column is followed through a rename the
 * same change makes, since the index Nextly drops names it as it was and the table it leaves names
 * it as it becomes; an index follows its column through a rename, so an older one would otherwise
 * keep the renamed column unique. A column the table drops, or still holds unique by an index it
 * declares, is not one. (`migrate:create` renames columns, never tables.)
 */
function uniqueStopping(
  operations: readonly Operation[],
  desired: readonly TableSpec[]
): DropIndexOp[] {
  return operations.filter((op): op is DropIndexOp => {
    if (op.type !== "drop_index") return false;
    if (!op.index.unique || op.index.columns.length !== 1) return false;
    const live = op.index.columns[0];
    const column =
      operations.find(
        (rename): rename is RenameColumnOp =>
          rename.type === "rename_column" &&
          rename.tableName === op.tableName &&
          rename.fromColumn === live
      )?.toColumn ?? live;
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

/**
 * Whether `name`, read from the database, is Nextly's own index `own`. PostgreSQL keeps a quoted
 * name's case, so a legacy `"UQ_DC_POSTS_CODE"` beside Nextly's `uq_dc_posts_code` is another
 * index; MySQL and SQLite fold an index name's case, so there it is the same one.
 */
function isOwn(name: string, own: string, dialect: SupportedDialect): boolean {
  return dialect === "postgresql"
    ? name === own
    : name.toLowerCase() === own.toLowerCase();
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
 * The indexes other than Nextly's own that `live` says hold the column `op` stops holding unique,
 * each one a statement can drop by name. One with no name is SQLite's index for a UNIQUE written in
 * the table's own definition (or a primary key), which no statement drops: the column stays unique
 * until the table is rebuilt without it, which is said to `warn`, as the file cannot do it. One
 * whose name holds the dialect's quote is a valid name no statement here can spell: said to `warn`,
 * for the person to drop by hand, rather than refused part-way through writing the file.
 */
function otherUniqueIndexes(
  op: DropIndexOp,
  live: ReadonlyMap<string, readonly (string | null)[]>,
  dialect: SupportedDialect,
  warn: (message: string) => void
): LeftoverUniqueIndex[] {
  const column = op.index.columns[0];
  const others: LeftoverUniqueIndex[] = [];
  for (const name of live.get(column) ?? []) {
    if (name === null) {
      warn(
        `${op.tableName} holds ${column} unique in its own definition as well (a UNIQUE written ` +
          `with the table), which no statement can drop: ${column} stays unique there until the ` +
          `table is rebuilt without it.`
      );
      continue;
    }
    if (isOwn(name, op.index.name, dialect)) continue;
    if (
      !canQuoteIdent(name, dialect) ||
      !canQuoteIdent(op.tableName, dialect)
    ) {
      warn(
        `${op.tableName} holds ${column} unique under the index ${name} as well, a name ` +
          `this migration cannot write. Drop that index by hand where it stands, or ${column} ` +
          `stays unique there.`
      );
      continue;
    }
    others.push({ table: op.tableName, column, index: name });
  }
  return others;
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
    for (const index of otherUniqueIndexes(op, live, args.dialect, args.warn)) {
      statements.push(
        ...guardedDrop(args.dialect, index.table, index.column, index.index)
      );
      dropped.push(index);
    }
  }
  return { statements, dropped };
}

/** What a run says of an older unique index its file drops. */
export function leftoverUniqueNotice(dropped: LeftoverUniqueIndex): string {
  return (
    `Drops the unique index ${dropped.index} on ${dropped.table}(${dropped.column}) as well as ` +
    `Nextly's own: ${dropped.column} is no longer unique, and that index still holds it so. ` +
    `Nextly did not name it, so it may be one you made. The file drops it by name: on each ` +
    `database it runs on, an index of that name is dropped where one exists, and nothing where none does.`
  );
}

/**
 * The file's statements for `leftoverUniqueDrops`, with each index they drop named to the run and
 * an unreadable table said, both through `onWarning` where the run listens. Kept here so the
 * generator gains one call, not the branches of saying what it drops.
 */
export async function leftoverUniqueStatements(args: {
  operations: readonly Operation[];
  desired: readonly TableSpec[];
  dialect: SupportedDialect;
  read: LiveUniqueIndexes | undefined;
  onWarning: ((message: string) => void) | undefined;
}): Promise<string[]> {
  const say = args.onWarning ?? (() => {});
  const { statements, dropped } = await leftoverUniqueDrops({
    ...args,
    warn: say,
  });
  for (const index of dropped) say(leftoverUniqueNotice(index));
  return statements;
}
