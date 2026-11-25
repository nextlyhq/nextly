/**
 * Whether the answers of a migration file have an entry to settle in the database a run starts
 * from. Where they have none (a new database, a table with no rows), the language they are decided
 * in decides nothing, and the file runs whatever it is.
 *
 * Read before the run's first statement, from the tables each answer names: the entity's own, whose
 * rows are the entries, and its translations table. The entity's is read because the translations
 * table may be one the same run makes and fills from it. What the run renames into place is read
 * back to the table it was: a table standing under another name before the run counts as holding
 * entries. Anything that cannot be told counts so too.
 *
 * A row the run itself puts in, by a statement of a hand-written file ahead of the answer, is not
 * there to be read.
 *
 * @module domains/i18n/migration/answered-entries
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { splitSqlStatements } from "../../schema/migrate/split-sql";
import {
  indexesRenamedBy,
  renamesIn,
  tablesDroppedBy,
  tablesChangedIn,
} from "../../schema/migrate/statement-targets";
import { countRows } from "../../schema/pipeline/classifier/count-helpers";
import { plainMysqlEquivalents } from "../../schema/pipeline/sql-templates/mysql-live-restate";
import { settledTablesOf } from "../../schema/pipeline/sql-templates/resolution-statements";

/** The run a file is part of: what it runs, in order, and the database it starts from. */
export interface AnswerRun {
  /** Every unit the run applies: its plugin modules and its files. */
  units: readonly { statements: readonly string[] }[];
  adapter: DrizzleAdapter;
  db: unknown;
  dialect: SupportedDialect;
}

/** A table renamed by a run, both names lower-cased. */
interface TableRename {
  from: string;
  to: string;
}

/**
 * The table renames `statement` makes, or undefined where it may make one that is not read: it
 * names a rename and is neither a form read here nor an index's.
 */
function renamesOf(
  statement: string,
  dialect: SupportedDialect
): TableRename[] | undefined {
  const whole = renamesIn(statement, dialect);
  if (whole !== undefined) {
    return whole.filter(rename => rename.kind === "table");
  }
  if (tablesDroppedBy(statement, dialect) !== undefined) return [];
  // An ALTER TABLE that does more than rename: its table, and each name it is renamed to.
  const changed = tablesChangedIn(statement, dialect);
  if (changed !== undefined) {
    const [from, ...to] = changed;
    return to.map(name => ({ from: from, to: name }));
  }
  const unread =
    /\brename\b/i.test(statement) &&
    indexesRenamedBy(statement, dialect) === undefined;
  return unread ? undefined : [];
}

/** Every table rename `units` make, or undefined where one of them may not be read (`renamesOf`). */
function tableRenames(
  units: AnswerRun["units"],
  dialect: SupportedDialect
): TableRename[] | undefined {
  // As the rename check reads them: a run built from the catalog is the one rename it amounts to.
  const each = units
    .flatMap(({ statements }) =>
      dialect === "mysql" ? plainMysqlEquivalents(statements) : statements
    )
    .map(statement => renamesOf(statement, dialect));
  return each.every(renames => renames !== undefined) ? each.flat() : undefined;
}

/** Whether the answers of the file `upSql` is of may have an entry to settle before `run` starts. */
export async function mayHaveEntriesToSettle(
  file: { name: string; upSql: string; transaction: boolean },
  run: AnswerRun
): Promise<boolean> {
  const { dialect } = run;
  const settled = splitSqlStatements(file.upSql, dialect, file).flatMap(
    statement => settledTablesOf(statement) ?? []
  );
  const entityOf = new Map(
    settled.flatMap(({ companion, main }) =>
      main === undefined ? [] : [[companion, main] as const]
    )
  );
  // No answer read, or one whose entity's table is not: what it settles is not known.
  if (
    settled.length === 0 ||
    settled.some(({ companion }) => !entityOf.has(companion))
  ) {
    return true;
  }
  const renames = tableRenames(run.units, dialect);
  if (renames === undefined) return true;
  try {
    const listed = await run.adapter.listTables();
    for (const name of new Set([...entityOf].flat())) {
      if (await mayHoldRows(name, { ...run, renames, listed })) return true;
    }
    return false;
  } catch {
    // A table that cannot be read may hold entries.
    return true;
  }
}

/** Whether `name` holds a row, or is renamed into place from a table standing before the run. */
async function mayHoldRows(
  name: string,
  run: AnswerRun & { renames: readonly TableRename[]; listed: string[] }
): Promise<boolean> {
  for (const table of await standingAs(name, run)) {
    if ((await countRows(run.db, run.dialect, table)) > 0) return true;
  }
  // Read back through what each name was renamed from, where the run made that table itself.
  const reached = new Set([name.toLowerCase()]);
  for (const to of reached) {
    for (const { from } of run.renames.filter(rename => rename.to === to)) {
      if ((await standingAs(from, run)).length > 0) return true;
      reached.add(from);
    }
  }
  return false;
}

/**
 * The tables standing as `name`, in any case: a rename's names are read lower-cased, and MySQL and
 * SQLite may hold them otherwise. One further along PostgreSQL's search path is not listed, and is
 * asked for by name.
 */
async function standingAs(
  name: string,
  run: AnswerRun & { listed: string[] }
): Promise<string[]> {
  const listed = run.listed.filter(
    table => table.toLowerCase() === name.toLowerCase()
  );
  if (listed.length > 0 || !(await run.adapter.tableExists(name))) {
    return listed;
  }
  return [name];
}
