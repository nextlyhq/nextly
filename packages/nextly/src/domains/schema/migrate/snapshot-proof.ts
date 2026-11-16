/**
 * Whether a pending app migration may be recorded applied without running it, because the
 * database already stands where it ends and its snapshot proves every effect it has.
 *
 * A database brought to a file's end some other way (`db:sync` on a shared database, or by hand)
 * shows the file's schema changes as done. It shows nothing else: a snapshot records tables with
 * their columns, indexes, checks and foreign keys, and no rows, triggers, views, functions,
 * sequences, extensions or grants. So recording the file without running it is sound only when
 * three things hold:
 *
 * 1. Every statement changes only what the snapshot records (`statementsShownBySnapshot`). The
 *    statements that pass are a closed list, read through the shared statement cursor; anything
 *    else, a statement this reading does not know included, fails, so it is never skipped:
 *    - table and index DDL on a table either side of the snapshot holds: `CREATE TABLE` creating
 *      it empty, `CREATE [UNIQUE] INDEX`, `DROP TABLE`, `DROP INDEX` of an index the snapshot
 *      records, MySQL's `RENAME TABLE`, and `ALTER TABLE` whose every clause adds, drops,
 *      alters, renames or validates a column, constraint, index or key, or renames the table;
 *    - a table the file creates and drops or renames into place again (a SQLite rebuild's twin,
 *      the rebuild's guard table), the rebuild's copy of the table's own rows, and the carry of
 *      its AUTOINCREMENT sequence;
 *    - MySQL's four-statement run `migrate:create` writes to change a column's nullability or
 *      rename a column a check uses (`mysqlLiveRunAt`);
 *    - the registry row `migrate:create` writes for an entity whose table the snapshot holds,
 *      which `nextly migrate` writes from the snapshot anyway;
 *    - a session setting from a short list (lock and statement timeouts, foreign-key checks), a
 *      savepoint, and the SQLite pragmas a rebuild uses.
 * 2. Its checksum matches the one recorded with its snapshot when it was written, so it is the
 *    file the snapshot describes.
 * 3. It has no unresolved attempt.
 *
 * Otherwise the run refuses before changing anything (`notProvenError`), naming the file, every
 * statement it would have skipped, and the next step.
 *
 * @module domains/schema/migrate/snapshot-proof
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import type { SchemaEventRow } from "../events/schema-events-repository";
import {
  createsEmptyTable,
  rebuildCopyStatements,
} from "../ownership/drop-guard";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import {
  MYSQL_LIVE_RUN_LENGTH,
  mysqlLiveRunAt,
} from "../pipeline/sql-templates/mysql-live-restate";
import { literalOf } from "../pipeline/sql-templates/sqlite-swap";
import { registryRowKeys } from "../ui-schema/registry-row-keys";

import {
  cursorOf,
  StatementCursor,
  type StatementToken,
} from "./statement-cursor";
import {
  judgeStatements,
  labelOf,
  type JudgedStatement,
  type LiveSchema,
} from "./statement-judgement";
import { registryRowWrittenBy } from "./statement-targets";

/** One statement of a pending file, as the refusal names it. */
interface StatementProof {
  /** The statement's leading text, with no string literal's content (`labelOf`). */
  label: string;
  /**
   * `shown`: the snapshot shows what it does, and the database has it. `unshown`: the snapshot
   * cannot show what it does. `not-done`: the snapshot shows its kind, but the live database does
   * not stand as it leaves it (`judgeStatements`): an index left invalid, a constraint not
   * validated, an object absent.
   */
  status: "shown" | "unshown" | "not-done" | "unfilled";
}

/** A column a statement fills, in every row the table already holds, with its default. */
interface FilledColumn {
  table: string;
  column: string;
}

/** What the live database says of a pending file's statements, where it stands at the file's end. */
export interface LiveFacts {
  /** The live schema the statements are judged against (`readLiveSchema`). */
  schema: LiveSchema;
  /** How many rows hold NULL in `column` of `table` (`countNulls`). */
  nullsIn: (table: string, column: string) => Promise<number>;
}

/**
 * Each statement of a pending file the database stands at the end of, with what proves it
 * (`statementsShownBySnapshot`), the live database's word on it (`judgeStatements`), and, for a
 * statement that fills a nullable column's rows with its default, that no row still holds NULL
 * there: a database brought to the same schema by adding the column and setting its default
 * afterwards has the default and not the rows it would have filled. One count per such column, and
 * only here.
 */
export async function proveStatements(args: {
  statements: readonly string[];
  dialect: SupportedDialect;
  sides: { before: NextlySchemaSnapshot; target: NextlySchemaSnapshot };
  live: LiveFacts;
}): Promise<StatementProof[]> {
  const { statements, dialect, live } = args;
  const proofs = statementsShownBySnapshot(
    statements,
    dialect,
    args.sides,
    judgeStatements(statements, dialect, live.schema)
  );
  for (const [at, proof] of proofs.entries()) {
    if (
      proof.status === "shown" &&
      !inlineConstraintsUsable(statements[at], dialect, args.sides, live.schema)
    ) {
      proofs[at] = { ...proof, status: "not-done" };
    }
  }
  const filled = columnsFilledBy(statements, dialect);
  for (const [at, proof] of proofs.entries()) {
    if (proof.status !== "shown") continue;
    for (const { table, column } of filled[at]) {
      if ((await live.nullsIn(table, column)) > 0) {
        proofs[at] = { ...proof, status: "unfilled" };
        break;
      }
    }
  }
  return proofs;
}

/**
 * Whether the foreign keys and checks a `CREATE TABLE` declares in its body, as the target snapshot
 * records them, are ones the live database can use: on PostgreSQL a constraint added `NOT VALID`
 * is there but unvalidated, which the snapshot comparison cannot see (`LiveSchema.usable`). True
 * for any other statement.
 */
function inlineConstraintsUsable(
  statement: string,
  dialect: SupportedDialect,
  sides: { target: NextlySchemaSnapshot },
  schema: LiveSchema
): boolean {
  const name = createdTable(statement, dialect);
  const table = sides.target.tables.find(
    each => each.name.toLowerCase() === name
  );
  if (table === undefined) return true;
  return [...(table.foreignKeys ?? []), ...(table.checks ?? [])].every(
    constraint =>
      schema.usable({
        kind: "constraint",
        table: table.name,
        name: constraint.name,
      })
  );
}

/**
 * For each statement, the nullable columns it fills with a default in every row its table holds:
 * `ALTER TABLE ... ADD [COLUMN] c ... DEFAULT <value>`, and a SQLite rebuild's copy, for each
 * column of the twin it leaves to its default (`ownRowsCopy`). A NOT NULL column holds no NULL to
 * find, so it is not counted.
 */
function columnsFilledBy(
  statements: readonly string[],
  dialect: SupportedDialect
): FilledColumn[][] {
  return statements.map(statement => {
    const copy = ownRowsCopy(statement, dialect);
    if (copy === undefined) return columnsAddedWithDefault(statement, dialect);
    const create = statements.find(
      other => createdTable(other, dialect) === copy.twin
    );
    return create === undefined
      ? []
      : twinColumnsLeftToDefault(create, copy, dialect);
  });
}

/** The columns of a rebuild's twin with a default that its copy leaves out: filled by it. */
function twinColumnsLeftToDefault(
  create: string,
  copy: { twin: string; columns: string[] },
  dialect: SupportedDialect
): FilledColumn[] {
  const table = copy.twin.replace(/^__new_/, "");
  return columnDefinitions(create, dialect)
    .filter(
      ([column, tail]) =>
        !copy.columns.includes(column) && fillsWithDefault(tail)
    )
    .map(([column]) => ({ table, column }));
}

/** Each column a `CREATE TABLE` body defines, with the tokens after its name. */
function columnDefinitions(
  create: string,
  dialect: SupportedDialect
): Array<[string, StatementToken[]]> {
  const cursor = cursorOf(create, dialect, EXACT);
  cursor.accept("CREATE", "TABLE");
  cursor.acceptCondition();
  if (cursor.name() === undefined || !cursor.accept("(")) return [];
  const body = cursor.rest();
  return new StatementCursor(body.slice(0, body.lastIndexOf(")")))
    .clauses()
    .flatMap(tokens => {
      const definition = new StatementCursor(tokens);
      if (nextIn(definition, TABLE_CONSTRAINT_WORDS)) return [];
      const column = definition.name();
      return column === undefined ? [] : [[column, definition.rest()]];
    });
}

/** Words opening a table constraint in a `CREATE TABLE` body, not a column. */
const TABLE_CONSTRAINT_WORDS = new Set([
  "CONSTRAINT",
  "PRIMARY",
  "UNIQUE",
  "FOREIGN",
  "CHECK",
]);

/** `ALTER TABLE t ADD [COLUMN] [IF NOT EXISTS] c ... DEFAULT <value>` clauses, nullable ones. */
function columnsAddedWithDefault(
  statement: string,
  dialect: SupportedDialect
): FilledColumn[] {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (!cursor.accept("ALTER", "TABLE")) return [];
  cursor.acceptCondition();
  if (dialect === "postgresql") cursor.accept("ONLY");
  const table = cursor.name();
  if (table === undefined) return [];
  return cursor.clauses().flatMap(tokens => {
    const clause = new StatementCursor(tokens);
    if (!clause.accept("ADD")) return [];
    clause.accept("COLUMN");
    clause.acceptCondition();
    const column = clause.name();
    return column !== undefined && fillsWithDefault(clause.rest())
      ? [{ table, column }]
      : [];
  });
}

/**
 * Whether a column definition's tail gives it a default other than NULL while leaving it nullable:
 * the rows it fills could have been left NULL by another way to the same schema.
 */
function fillsWithDefault(tail: readonly StatementToken[]): boolean {
  const at = tail.indexOf("DEFAULT");
  if (at === -1 || tail[at + 1] === "NULL") return false;
  const notNull = tail.some(
    (token, i) => token === "NOT" && tail[i + 1] === "NULL"
  );
  return !notNull && !tail.includes("PRIMARY");
}

/** Verdicts of the live database that say a statement's effect is not there (`judgeStatements`). */
function liveDisagrees(judged: JudgedStatement | undefined): boolean {
  if (judged === undefined) return false;
  if (judged.verdict === "not_done") return true;
  return judged.reason === "mixed" || judged.reason === "no_table";
}

/** The names a file's two snapshot sides record, lower-cased. */
interface SnapshotObjects {
  tables: ReadonlySet<string>;
  indexes: ReadonlySet<string>;
}

function objectsOf(sides: readonly NextlySchemaSnapshot[]): SnapshotObjects {
  const tables = new Set<string>();
  const indexes = new Set<string>();
  for (const table of sides.flatMap(side => side.tables)) {
    tables.add(table.name.toLowerCase());
    for (const index of table.indexes ?? []) {
      indexes.add(index.name.toLowerCase());
    }
  }
  return { tables, indexes };
}

/**
 * Quoted names are read only as written in lower case: PostgreSQL keeps a quoted name's case, so
 * `"Posts"` is not the snapshot's `posts`, and a name in another case fails closed.
 */
const EXACT = { exactQuotedNames: true } as const;

/** Session settings that last no longer than the run and change no object. */
const SESSION_SETTINGS = new Set([
  "LOCK_TIMEOUT",
  "STATEMENT_TIMEOUT",
  "IDLE_IN_TRANSACTION_SESSION_TIMEOUT",
  "FOREIGN_KEY_CHECKS",
  "UNIQUE_CHECKS",
  "LOCK_WAIT_TIMEOUT",
  "INNODB_LOCK_WAIT_TIMEOUT",
]);

/** The SQLite pragmas a table rebuild uses, none of which outlives the connection's run. */
const REBUILD_PRAGMAS = new Set([
  "FOREIGN_KEYS",
  "FOREIGN_KEY_CHECK",
  "DEFER_FOREIGN_KEYS",
  "LEGACY_ALTER_TABLE",
]);

/** Words after `ADD` or `DROP` in an `ALTER TABLE` clause that name what follows. */
const ELEMENT_WORDS = new Set([
  "COLUMN",
  "CONSTRAINT",
  "UNIQUE",
  "PRIMARY",
  "FOREIGN",
  "CHECK",
]);
/** MySQL's further element words after `ADD` or `DROP`. */
const MYSQL_ELEMENT_WORDS = new Set(["INDEX", "KEY"]);

/** What `ALTER [COLUMN] c` may go on to change: what the snapshot records of a column. */
const COLUMN_CHANGES: readonly (readonly string[])[] = [
  ["TYPE"],
  ["SET", "DATA", "TYPE"],
  ["SET", "NOT", "NULL"],
  ["DROP", "NOT", "NULL"],
  ["SET", "DEFAULT"],
  ["DROP", "DEFAULT"],
];

/** What one statement's reading needs to know of the file around it. */
interface FileContext {
  dialect: SupportedDialect;
  objects: SnapshotObjects;
  /** Tables an earlier statement of the file created. */
  created: ReadonlySet<string>;
  /** Tables a later statement drops, or renames into a table the snapshot holds. */
  goneLater: ReadonlySet<string>;
  /** Tables a later statement drops: gone by the end, with any rows written into them. */
  droppedLater: ReadonlySet<string>;
}

/** A table the statement may change: the snapshot holds it, or the file itself created it. */
function known(table: string | undefined, file: FileContext): boolean {
  return (
    table !== undefined &&
    (file.objects.tables.has(table) || file.created.has(table))
  );
}

/**
 * Each statement of a pending file, labelled, with whether the snapshot shows what it does. The
 * snapshot's two sides are the ones the file was written between, whole (not narrowed to what
 * the app contributes), so a table either holds is one the comparison read.
 */
export function statementsShownBySnapshot(
  statements: readonly string[],
  dialect: SupportedDialect,
  sides: { before: NextlySchemaSnapshot; target: NextlySchemaSnapshot },
  /**
   * The same statements judged against the live database (`judgeStatements`): a schema statement
   * the snapshot shows is still not proven where the database does not stand as it leaves it,
   * which the snapshot comparison cannot see (an index left invalid, a constraint not validated).
   */
  judged: readonly JudgedStatement[] = []
): StatementProof[] {
  const objects = objectsOf([sides.before, sides.target]);
  const shown = statements.map(() => false);
  const runs = mysqlRunsAt(statements, dialect, objects);
  const copies = rebuildCopyStatements(statements, dialect);
  const goneAfter = tablesAfter(statements, statement =>
    goneBy(statement, dialect, objects.tables)
  );
  const droppedAfter = tablesAfter(statements, statement =>
    droppedBy(statement, dialect)
  );
  const created = new Set<string>();
  statements.forEach((statement, at) => {
    const file: FileContext = {
      dialect,
      objects,
      created,
      goneLater: goneAfter[at],
      droppedLater: droppedAfter[at],
    };
    shown[at] =
      runs.has(at) ||
      copies.has(at) ||
      isSequenceCarry(statement, statements, dialect, objects) ||
      isOwnRegistryRow(statement, dialect, objects) ||
      statementShown(statement, file);
    const made = createdTable(statement, dialect);
    if (made !== undefined) created.add(made);
  });
  return statements.map((statement, at) => ({
    label: labelOf(statement, dialect),
    status: !shown[at]
      ? "unshown"
      : liveDisagrees(judged[at])
        ? "not-done"
        : "shown",
  }));
}

/** The positions of MySQL's generated four-statement runs on a table the snapshot holds. */
function mysqlRunsAt(
  statements: readonly string[],
  dialect: SupportedDialect,
  objects: SnapshotObjects
): ReadonlySet<number> {
  const positions = new Set<number>();
  if (dialect !== "mysql") return positions;
  for (let at = 0; at < statements.length; at += 1) {
    const run = mysqlLiveRunAt(statements, at);
    if (run === undefined || !objects.tables.has(run.tableName.toLowerCase())) {
      continue;
    }
    for (let k = 0; k < MYSQL_LIVE_RUN_LENGTH; k += 1) positions.add(at + k);
    at += MYSQL_LIVE_RUN_LENGTH - 1;
  }
  return positions;
}

/** For each statement, the tables `read` names in the statements after it. */
function tablesAfter(
  statements: readonly string[],
  read: (statement: string) => string[]
): ReadonlySet<string>[] {
  const after: ReadonlySet<string>[] = [];
  let later = new Set<string>();
  for (let at = statements.length - 1; at >= 0; at -= 1) {
    after[at] = later;
    later = new Set([...later, ...read(statements[at])]);
  }
  return after;
}

/** The tables one statement drops, or renames into a table the snapshot holds. */
function goneBy(
  statement: string,
  dialect: SupportedDialect,
  tables: ReadonlySet<string>
): string[] {
  const dropped = droppedBy(statement, dialect);
  if (dropped.length > 0) return dropped;
  const renames = tableRenamesOf(cursorOf(statement, dialect, EXACT), dialect);
  if (renames === undefined) return [];
  return renames.filter(([, to]) => tables.has(to)).map(([from]) => from);
}

/** The tables a `DROP TABLE` drops; none for any other statement. */
function droppedBy(statement: string, dialect: SupportedDialect): string[] {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (!cursor.accept("DROP", "TABLE")) return [];
  cursor.acceptCondition();
  return cursor.names() ?? [];
}

/**
 * The tables a statement renames, as `[from, to]` pairs: `ALTER TABLE [IF EXISTS] [ONLY] a RENAME
 * TO|AS b`, or MySQL's `RENAME TABLE a TO b[, c TO d]`. Undefined for any other statement, or one
 * that does more. The one reading of a rename, for what is gone and for what is shown.
 */
function tableRenamesOf(
  cursor: StatementCursor,
  dialect: SupportedDialect
): Array<[string, string]> | undefined {
  if (dialect === "mysql" && cursor.accept("RENAME", "TABLE")) {
    return renamePairs(cursor);
  }
  if (!cursor.accept("ALTER", "TABLE")) return undefined;
  cursor.acceptCondition();
  if (dialect === "postgresql") cursor.accept("ONLY");
  const pair = alterTableRename(cursor);
  return pair === undefined ? undefined : [pair];
}

/** After `ALTER TABLE`'s prefix: `a RENAME TO|AS b`, as the whole statement, or undefined. */
function alterTableRename(
  cursor: StatementCursor
): [string, string] | undefined {
  const from = cursor.name();
  if (from === undefined || !cursor.accept("RENAME")) return undefined;
  if (!cursor.accept("TO")) cursor.accept("AS");
  const to = cursor.name();
  return to !== undefined && cursor.done() ? [from, to] : undefined;
}

/** `a TO b[, c TO d]`, the whole rest of the statement, or undefined. */
function renamePairs(
  cursor: StatementCursor
): Array<[string, string]> | undefined {
  const pairs: Array<[string, string]> = [];
  do {
    const from = cursor.name();
    if (from === undefined || !cursor.accept("TO")) return undefined;
    const to = cursor.name();
    if (to === undefined) return undefined;
    pairs.push([from, to]);
  } while (cursor.accept(","));
  return cursor.done() ? pairs : undefined;
}

/** The table a `CREATE TABLE` creates, or undefined for any other statement. */
function createdTable(
  statement: string,
  dialect: SupportedDialect
): string | undefined {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (!cursor.accept("CREATE", "TABLE")) return undefined;
  cursor.acceptCondition();
  return cursor.name();
}

/**
 * A SQLite rebuild's carry of a table's AUTOINCREMENT sequence to its twin, exactly as the rebuild
 * writes it (`sqliteSwapStatements`), for a table the file rebuilds and the snapshot holds.
 */
function isSequenceCarry(
  statement: string,
  statements: readonly string[],
  dialect: SupportedDialect,
  objects: SnapshotObjects
): boolean {
  if (dialect !== "sqlite") return false;
  return [...objects.tables].some(table => {
    const twin = `__new_${table}`;
    const carry =
      `INSERT INTO sqlite_sequence (name, seq) SELECT ${literalOf(twin)}, seq ` +
      `FROM sqlite_sequence WHERE name = ${literalOf(table)}`;
    return (
      statement.trim().replace(/;$/, "") === carry &&
      statements.some(other => createdTable(other, dialect) === twin)
    );
  });
}

/** A registry row `migrate:create` writes, for an entity whose table the snapshot holds. */
function isOwnRegistryRow(
  statement: string,
  dialect: SupportedDialect,
  objects: SnapshotObjects
): boolean {
  const row = registryRowWrittenBy(statement, dialect);
  if (row === undefined) return false;
  const keys = registryRowKeys(row.table, row.slug);
  return keys !== undefined && objects.tables.has(keys.table_name);
}

/** One kind of statement on the closed list: its leading words, and how the rest is judged. */
type StatementReader = readonly [
  readonly string[],
  (cursor: StatementCursor, file: FileContext, statement: string) => boolean,
];

/** The statements on the closed list, by their leading words, longest first where two share some. */
const STATEMENT_READERS: readonly StatementReader[] = [
  [["CREATE", "TABLE"], createTableShown],
  [["CREATE", "UNIQUE", "INDEX"], createIndexShown],
  [["CREATE", "INDEX"], createIndexShown],
  [["DROP", "TABLE"], dropTablesShown],
  [["DROP", "INDEX"], dropIndexShown],
  [["INSERT", "INTO"], guardRowsShown],
];

/** Whether one statement, read alone, is on the closed list (see the module comment). */
function statementShown(statement: string, file: FileContext): boolean {
  const renames = tableRenamesOf(
    cursorOf(statement, file.dialect, EXACT),
    file.dialect
  );
  if (renames !== undefined)
    return renames.every(pair => renameShown(pair, file));
  const cursor = cursorOf(statement, file.dialect, EXACT);
  const reader = STATEMENT_READERS.find(([words]) => cursor.accept(...words));
  if (reader !== undefined) return reader[1](cursor, file, statement);
  if (cursor.accept("ALTER", "TABLE")) return alterTableShown(cursor, file);
  return isSessionSetting(cursor, file.dialect);
}

/** A table renamed from one the file may change into one the snapshot holds, or scaffolding. */
function renameShown([from, to]: [string, string], file: FileContext): boolean {
  return (
    known(from, file) && (file.objects.tables.has(to) || file.goneLater.has(to))
  );
}

/**
 * `CREATE TABLE [IF NOT EXISTS] t ...` creating its table empty (`createsEmptyTable`), of a table
 * the snapshot holds or scaffolding the file removes or moves into place again.
 */
function createTableShown(
  cursor: StatementCursor,
  file: FileContext,
  statement: string
): boolean {
  cursor.acceptCondition();
  const name = cursor.name();
  if (name === undefined || !createsEmptyTable(statement, file.dialect)) {
    return false;
  }
  return file.objects.tables.has(name) || file.goneLater.has(name);
}

/** `DROP TABLE [IF EXISTS] a[, b...] [CASCADE|RESTRICT]`, of tables the file may change. */
function dropTablesShown(cursor: StatementCursor, file: FileContext): boolean {
  cursor.acceptCondition();
  const names = cursor.names();
  if (!cursor.accept("CASCADE")) cursor.accept("RESTRICT");
  return (
    names !== undefined &&
    cursor.done() &&
    names.every(name => known(name, file))
  );
}

/**
 * Rows written into a table the file created: a rebuild's guard, dropped again by the end, or a
 * rebuild's copy of a table's own rows into its twin, moved into place (`ownRowsCopy`). Rows of
 * any other kind put into a table moved into place outlive the file, and are not shown.
 */
function guardRowsShown(
  cursor: StatementCursor,
  file: FileContext,
  statement: string
): boolean {
  const into = cursor.name();
  if (into === undefined || !file.created.has(into)) return false;
  if (file.objects.tables.has(into)) return false;
  if (file.droppedLater.has(into)) return true;
  return (
    file.goneLater.has(into) &&
    ownRowsCopy(statement, file.dialect)?.twin === into
  );
}

/**
 * A rebuild's copy of a table's own rows into its twin: `INSERT INTO __new_t (a, b) SELECT a, b
 * FROM t`, the same columns in both lists. The twin's other columns take their defaults
 * (`columnsFilledBy`).
 */
function ownRowsCopy(
  statement: string,
  dialect: SupportedDialect
): { twin: string; columns: string[] } | undefined {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (!cursor.accept("INSERT", "INTO")) return undefined;
  const twin = cursor.name();
  const columns = sameColumnsCopied(cursor);
  if (twin === undefined || columns === undefined) return undefined;
  if (!cursor.accept("FROM")) return undefined;
  const table = cursor.name();
  return cursor.done() && twin === `__new_${table}`
    ? { twin, columns }
    : undefined;
}

/** `(a, b) SELECT a, b`: the columns, when both lists name the same ones in the same order. */
function sameColumnsCopied(cursor: StatementCursor): string[] | undefined {
  if (!cursor.accept("(")) return undefined;
  const into = cursor.names();
  if (into === undefined || !cursor.accept(")", "SELECT")) return undefined;
  const selected = cursor.names();
  const same =
    selected?.length === into.length &&
    selected.every((column, at) => column === into[at]);
  return same ? into : undefined;
}

/** `CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] n ON [ONLY] t ...`. */
function createIndexShown(cursor: StatementCursor, file: FileContext): boolean {
  if (file.dialect === "postgresql") cursor.accept("CONCURRENTLY");
  cursor.acceptCondition();
  if (cursor.isWord("ON")) return false;
  if (cursor.name() === undefined || !cursor.accept("ON")) return false;
  if (file.dialect === "postgresql") cursor.accept("ONLY");
  return known(cursor.name(), file);
}

/** `DROP INDEX [CONCURRENTLY] [IF EXISTS] n [ON t] [CASCADE|RESTRICT]`. */
function dropIndexShown(cursor: StatementCursor, file: FileContext): boolean {
  if (file.dialect === "postgresql") cursor.accept("CONCURRENTLY");
  cursor.acceptCondition();
  const name = cursor.name();
  if (name === undefined) return false;
  // The index must be one the snapshot records, on a table it may change where the drop names one.
  let shown = file.objects.indexes.has(name);
  if (cursor.accept("ON")) shown = shown && known(cursor.name(), file);
  if (!cursor.accept("CASCADE")) cursor.accept("RESTRICT");
  return shown && cursor.done();
}

/** `ALTER TABLE [IF EXISTS] [ONLY] t <clause>[, <clause>...]`, every clause on the list. */
function alterTableShown(cursor: StatementCursor, file: FileContext): boolean {
  cursor.acceptCondition();
  if (file.dialect === "postgresql") cursor.accept("ONLY");
  const name = cursor.name();
  if (!known(name, file)) return false;
  return cursor
    .clauses()
    .every(tokens => alterClauseShown(new StatementCursor(tokens), file));
}

/** One `ALTER TABLE` clause's reader: whether what it changes is one the snapshot records. */
type ClauseReader = readonly [
  readonly string[],
  (clause: StatementCursor, file: FileContext) => boolean,
];

/**
 * The `ALTER TABLE` clauses on the list, by their leading words. A table rename is not among them:
 * it must be a statement's only clause, and is read as a rename (`tableRenamesOf`).
 */
const CLAUSE_READERS: readonly ClauseReader[] = [
  [["ADD"], (clause, file) => elementFollows(clause, file, true)],
  [["DROP"], (clause, file) => elementFollows(clause, file, false)],
  [["ALTER"], columnChangeShown],
  [["MODIFY"], restatedColumnShown],
  [["CHANGE"], restatedColumnShown],
  [["VALIDATE", "CONSTRAINT"], (_clause, file) => file.dialect !== "mysql"],
  [["RENAME"], elementRenameShown],
];

/** One `ALTER TABLE` clause: what it changes is a column, constraint, index or key. */
function alterClauseShown(clause: StatementCursor, file: FileContext): boolean {
  const reader = CLAUSE_READERS.find(([words]) => clause.accept(...words));
  return reader !== undefined && reader[1](clause, file);
}

/**
 * `ALTER [COLUMN] c` then what the snapshot records of a column: its type (converted by a plain
 * cast of itself, `castsItself`), whether it is nullable, its default.
 */
function columnChangeShown(clause: StatementCursor): boolean {
  clause.accept("COLUMN");
  const column = clause.name();
  if (column === undefined) return false;
  const change = COLUMN_CHANGES.find(words => clause.accept(...words));
  if (change === undefined) return false;
  return change.at(-1) !== "TYPE" || castsItself(clause.rest(), column);
}

/** MySQL's `MODIFY [COLUMN] c ...` and `CHANGE [COLUMN] a b ...`: a column's definition restated. */
function restatedColumnShown(
  clause: StatementCursor,
  file: FileContext
): boolean {
  if (file.dialect !== "mysql") return false;
  clause.accept("COLUMN");
  return clause.name() !== undefined;
}

/** `RENAME [COLUMN] a TO b`, or MySQL's `RENAME INDEX|KEY a TO b`, as the whole clause. */
function elementRenameShown(
  clause: StatementCursor,
  file: FileContext
): boolean {
  const index =
    file.dialect === "mysql" &&
    (clause.accept("INDEX") || clause.accept("KEY"));
  if (!index) clause.accept("COLUMN");
  return renamePairs(clause)?.length === 1;
}

/**
 * What follows `ADD` or `DROP`: an element word the list names, or a column's name (a quoted name,
 * or a plain word that is not a keyword of another clause).
 */
function elementFollows(
  clause: StatementCursor,
  file: FileContext,
  adding: boolean
): boolean {
  if (adding && clause.accept("CONSTRAINT"))
    return namedConstraintAdded(clause);
  const next = clause.peek();
  if (typeof next !== "string") return clause.name() !== undefined;
  return elementWord(next, file.dialect) || plainColumnName(next);
}

/** A named constraint added must be of a kind the snapshot records: not an `EXCLUDE`, say. */
function namedConstraintAdded(clause: StatementCursor): boolean {
  if (clause.name() === undefined) return false;
  return nextIn(clause, CONSTRAINT_KINDS);
}

/** A word naming the element an `ADD` or `DROP` clause changes. */
function elementWord(word: string, dialect: SupportedDialect): boolean {
  return (
    ELEMENT_WORDS.has(word) ||
    (dialect === "mysql" && MYSQL_ELEMENT_WORDS.has(word))
  );
}

/** A plain word read as a column's name: not a keyword of another clause. */
function plainColumnName(word: string): boolean {
  return /^[A-Z_][A-Z0-9_$]*$/.test(word) && !NOT_A_COLUMN.has(word);
}

/** The kinds of constraint the snapshot records. */
const CONSTRAINT_KINDS = new Set(["UNIQUE", "PRIMARY", "FOREIGN", "CHECK"]);

/**
 * Whether what follows a column's new type converts each value by a plain cast of the column
 * itself, as `migrate:create` writes it (`USING "c"` or `USING "c"::<type>`), or names no
 * conversion. Any other `USING` rewrites the values by an expression the snapshot cannot show.
 */
function castsItself(tail: readonly StatementToken[], column: string): boolean {
  const at = tail.indexOf("USING");
  if (at === -1) return true;
  const using = new StatementCursor(tail.slice(at + 1));
  if (using.name() !== column) return false;
  if (using.done()) return true;
  if (!using.accept(":", ":") && !using.accept("::")) return false;
  return using
    .rest()
    .every(
      token =>
        typeof token === "string" &&
        (/^[A-Z_][A-Z0-9_]*$/.test(token) ||
          /^[0-9]+$/.test(token) ||
          ["(", ")", ",", "[", "]"].includes(token))
    );
}

/** Words after `ADD` or `DROP` that change something other than a column. */
const NOT_A_COLUMN = new Set([
  "PARTITION",
  "FULLTEXT",
  "SPATIAL",
  "INDEX",
  "KEY",
  "DEFAULT",
  "EXPRESSION",
  "IDENTITY",
]);

/**
 * A session setting from the short list, a savepoint, or a SQLite rebuild pragma: none outlives the
 * run or changes an object. `SET GLOBAL`, `SET search_path` and anything else are not on it.
 */
function isSessionSetting(
  cursor: StatementCursor,
  dialect: SupportedDialect
): boolean {
  if (cursor.accept("SAVEPOINT") || cursor.accept("RELEASE")) return true;
  if (cursor.accept("ROLLBACK", "TO")) return true;
  if (cursor.accept("PRAGMA")) {
    return dialect === "sqlite" && nextIn(cursor, REBUILD_PRAGMAS);
  }
  if (!cursor.accept("SET")) return false;
  if (!cursor.accept("LOCAL")) cursor.accept("SESSION");
  return nextIn(cursor, SESSION_SETTINGS);
}

/** Whether the next token is a word in `words`. */
function nextIn(cursor: StatementCursor, words: ReadonlySet<string>): boolean {
  const next = cursor.peek();
  return typeof next === "string" && words.has(next);
}

/** Why a pending file at its end is not recorded without running: each condition it fails. */
interface UnprovenReasons {
  /** Its checksum and the snapshot's, when they differ; the snapshot's is blank when it has none. */
  changed?: { checksum: string; recorded: string };
  /** Its unresolved attempt's outcome: failed, or none recorded. */
  attempt?: "failed" | "no-outcome";
  /** Rows dangling through a foreign key it adds (`SnapshotProof.dangling`). */
  dangling?: readonly DanglingReference[];
}

/** The first characters of a checksum, enough to tell two apart. */
const short = (checksum: string): string =>
  checksum.length > 12 ? `${checksum.slice(0, 12)}…` : checksum;

/** How the refusal marks each statement, by its status. */
const MARKS: Record<StatementProof["status"], string> = {
  shown: "the database has it",
  unshown: "not shown by its snapshot",
  "not-done": "the database does not stand as it leaves it",
  unfilled: "rows it fills with its default are still NULL",
};

/** `n` statements, in words. */
const statementCount = (n: number): string =>
  n === 1 ? "1 statement" : `${n} statements`;

/** Each reason the file is not proven, as the refusal words it. */
function reasonsOf(
  reasons: UnprovenReasons,
  statements: readonly StatementProof[]
): string[] {
  return REASON_LINES.flatMap(line => line(reasons, statements) ?? []);
}

/** One reason's line, or undefined where it does not hold. */
type ReasonLine = (
  reasons: UnprovenReasons,
  statements: readonly StatementProof[]
) => string | undefined;

/** The line for statements of one status, where any is. */
const statusLine =
  (
    status: StatementProof["status"],
    words: (count: number) => string
  ): ReasonLine =>
  (_reasons, statements) => {
    const count = statements.filter(each => each.status === status).length;
    return count > 0 ? words(count) : undefined;
  };

/** Each reason's line, in the order the refusal gives them. */
const REASON_LINES: readonly ReasonLine[] = [
  ({ changed }) =>
    changed === undefined
      ? undefined
      : changed.recorded === ""
        ? "its snapshot records no checksum to show it is the file the snapshot was written with"
        : `it has changed since its snapshot was written (checksum ${short(changed.checksum)}, the snapshot recorded ${short(changed.recorded)})`,
  ({ attempt }) =>
    attempt === undefined
      ? undefined
      : attempt === "failed"
        ? "its last attempt failed"
        : "its last attempt recorded no outcome",
  ({ dangling }) =>
    dangling === undefined ? undefined : danglingLine(dangling),
  statusLine(
    "unshown",
    n =>
      `its snapshot does not show what ${statementCount(n)} ${n === 1 ? "does" : "do"}`
  ),
  statusLine(
    "unfilled",
    n =>
      `the database holds rows ${statementCount(n)} would have filled with ${n === 1 ? "its default" : "their defaults"}, still NULL`
  ),
  statusLine(
    "not-done",
    n =>
      `the database does not stand as ${statementCount(n)} ${n === 1 ? "leaves" : "leave"} it`
  ),
];

/** The line for rows dangling through a foreign key the file adds. */
function danglingLine(dangling: readonly DanglingReference[]): string {
  const rows = dangling.reduce((sum, entry) => sum + entry.rows, 0);
  const pairs = dangling
    .slice(0, 5)
    .map(entry => `${entry.table} → ${entry.parent}`)
    .join(", ");
  return `the database holds ${rows} row(s) referencing rows that do not exist through a foreign key it adds (${pairs}), which a run of it would refuse`;
}

/**
 * The step the refusal names: the statements to look at by hand, where any is marked, or else the
 * change or attempt the reasons name; then the record.
 */
function nextStepOf(
  name: string,
  statements: readonly StatementProof[]
): string {
  const record = `then record the file with \`nextly migrate:resolve --applied ${name}\` and run \`nextly migrate\` again.`;
  return statements.some(statement => statement.status !== "shown")
    ? `Run the statements not marked "the database has it" by hand, or confirm they are not needed, ${record}`
    : `Check that what the file does is in the database, ${record}`;
}

/**
 * The refusal for a pending file the database stands at the end of whose snapshot does not prove
 * all of it, before anything of the file runs or is recorded: it names each statement a recording
 * would have skipped, marked by what the database shows of it. Its message is read back by the
 * CLI's describer (`notProvenParts`): the first sentence, the reasons and the statements, then the
 * next step on the last line.
 */
function notProvenError(args: {
  filename: string;
  statements: readonly StatementProof[];
  reasons: UnprovenReasons;
}): NextlyError {
  const { filename, statements } = args;
  const name = filename.replace(/\.sql$/, "");
  const listed = statements.map(
    (statement, at) =>
      `  ${at + 1}. ${statement.label} (${MARKS[statement.status]})`
  );
  return new NextlyError({
    code: "NEXTLY_MIGRATION_NOT_PROVEN",
    publicMessage: [
      `${filename} is pending, and the database already stands where it ends, not where it starts. It was neither run nor recorded as applied without running: ${reasonsOf(args.reasons, statements).join("; ")}.`,
      "Statements it would have skipped:",
      ...listed,
      nextStepOf(name, statements),
    ].join("\n"),
    logContext: {
      source: filename,
      migration: name,
      reason: "not-proven",
    },
  });
}

/**
 * What `nextly migrate` hands the reconcile for an app file with a snapshot: each statement's
 * reading (`statementsShownBySnapshot`) and the checksum its snapshot recorded when it was
 * written (`migrationHash`, blank when it has none).
 */
export interface SnapshotProof {
  statements: readonly StatementProof[];
  recordedChecksum: string;
  /**
   * On SQLite, the rows referencing rows that do not exist through a foreign key the file adds
   * (`danglingOnAddedKeys`): a run of the file is refused for them, as for any reference it leaves
   * dangling (`refusingNewDanglingReferences`), so its record without running is too.
   */
  dangling?: readonly DanglingReference[];
}

/** Rows of `table` referencing rows of `parent` that do not exist. */
interface DanglingReference {
  table: string;
  parent: string;
  rows: number;
}

/**
 * The dangling references through a foreign key the file adds: one its target snapshot declares
 * on a table and its earlier snapshot does not. Rows that dangle through a key the database already
 * had are not the file's doing, and a run of it would not be refused for them either.
 */
export function danglingOnAddedKeys(
  sides: { before: NextlySchemaSnapshot; target: NextlySchemaSnapshot },
  dangling: readonly DanglingReference[]
): DanglingReference[] {
  const earlier = new Set(
    sides.before.tables.flatMap(table =>
      (table.foreignKeys ?? []).map(key => `${table.name}\u0000${key.name}`)
    )
  );
  const added = new Set(
    sides.target.tables.flatMap(table =>
      (table.foreignKeys ?? [])
        .filter(key => !earlier.has(`${table.name}\u0000${key.name}`))
        .map(key => `${table.name}\u0000${key.referencesTable}`.toLowerCase())
    )
  );
  return dangling.filter(entry =>
    added.has(`${entry.table}\u0000${entry.parent}`.toLowerCase())
  );
}

/**
 * Refuses, before anything changes, to record a pending app file applied without running it
 * unless its snapshot proves all of it: every statement shown, its checksum the one its snapshot
 * recorded, and no unresolved attempt (`attempt`, read from its ledger rows by the caller), on
 * any dialect.
 */
export function refuseUnlessProven(args: {
  file: { filename: string; sha256?: string };
  proof: SnapshotProof;
  attempt: Pick<SchemaEventRow, "status"> | undefined;
}): void {
  const { file, proof, attempt } = args;
  const checksum = file.sha256 ?? "";
  const reasons: UnprovenReasons = {};
  if (proof.recordedChecksum === "" || proof.recordedChecksum !== checksum) {
    reasons.changed = { checksum, recorded: proof.recordedChecksum };
  }
  if (attempt !== undefined) {
    reasons.attempt = attempt.status === "failed" ? "failed" : "no-outcome";
  }
  if (proof.dangling !== undefined && proof.dangling.length > 0) {
    reasons.dangling = proof.dangling;
  }
  const proven =
    reasons.changed === undefined &&
    reasons.attempt === undefined &&
    reasons.dangling === undefined &&
    proof.statements.every(statement => statement.status === "shown");
  if (proven) return;
  throw notProvenError({
    filename: file.filename,
    statements: proof.statements,
    reasons,
  });
}
