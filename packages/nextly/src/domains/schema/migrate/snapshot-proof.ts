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
import { labelOf } from "./statement-judgement";
import { registryRowWrittenBy } from "./statement-targets";

/** One statement of a pending file, as the refusal names it. */
interface StatementProof {
  /** The statement's leading text, with no string literal's content (`labelOf`). */
  label: string;
  /** Whether the snapshot shows what it does, so the database standing at the end shows it done. */
  shown: boolean;
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
  sides: { before: NextlySchemaSnapshot; target: NextlySchemaSnapshot }
): StatementProof[] {
  const objects = objectsOf([sides.before, sides.target]);
  const shown = statements.map(() => false);
  const runs = mysqlRunsAt(statements, dialect, objects);
  const copies = rebuildCopyStatements(statements, dialect);
  const goneAfter = tablesGoneAfter(statements, dialect, objects);
  const created = new Set<string>();
  statements.forEach((statement, at) => {
    const file: FileContext = {
      dialect,
      objects,
      created,
      goneLater: goneAfter[at],
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
    shown: shown[at],
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

/**
 * For each statement, the tables a statement after it drops, or renames into a table the snapshot
 * holds: a table the file creates is scaffolding only when it is gone or in place by the end.
 */
function tablesGoneAfter(
  statements: readonly string[],
  dialect: SupportedDialect,
  objects: SnapshotObjects
): ReadonlySet<string>[] {
  const after: ReadonlySet<string>[] = [];
  let gone = new Set<string>();
  for (let at = statements.length - 1; at >= 0; at -= 1) {
    after[at] = gone;
    gone = new Set([
      ...gone,
      ...goneBy(statements[at], dialect, objects.tables),
    ]);
  }
  return after;
}

/** The tables one statement drops, or renames into a table the snapshot holds. */
function goneBy(
  statement: string,
  dialect: SupportedDialect,
  tables: ReadonlySet<string>
): string[] {
  const cursor = cursorOf(statement, dialect, EXACT);
  if (cursor.accept("DROP", "TABLE")) {
    cursor.acceptCondition();
    return cursor.names() ?? [];
  }
  const renames = tableRenamesOf(cursor, dialect);
  if (renames === undefined) return [];
  return renames.filter(([, to]) => tables.has(to)).map(([from]) => from);
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
  const from = cursor.name();
  if (from === undefined || !cursor.accept("RENAME")) return undefined;
  if (!cursor.accept("TO")) cursor.accept("AS");
  const to = cursor.name();
  return to !== undefined && cursor.done() ? [[from, to]] : undefined;
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

/** Rows written into a table the file created and drops again: a rebuild's guard. */
function guardRowsShown(cursor: StatementCursor, file: FileContext): boolean {
  const into = cursor.name();
  return (
    into !== undefined &&
    file.created.has(into) &&
    !file.objects.tables.has(into) &&
    file.goneLater.has(into)
  );
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
}

/** The first characters of a checksum, enough to tell two apart. */
const short = (checksum: string): string =>
  checksum.length > 12 ? `${checksum.slice(0, 12)}…` : checksum;

/**
 * The refusal for a pending file the database stands at the end of whose snapshot does not prove
 * all of it, before anything of the file runs or is recorded: it names each statement a recording
 * would have skipped. Its message is read back by the CLI's describer (`notProvenParts`): the
 * first sentence, the reasons and the statements, then the next step on the last line.
 */
function notProvenError(args: {
  filename: string;
  statements: readonly StatementProof[];
  reasons: UnprovenReasons;
}): NextlyError {
  const { filename, reasons } = args;
  const name = filename.replace(/\.sql$/, "");
  // A changed file, or one an attempt may have reached, proves nothing by its snapshot.
  const trusted =
    reasons.changed === undefined && reasons.attempt === undefined;
  const statements = args.statements.map(statement => ({
    ...statement,
    shown: trusted && statement.shown,
  }));
  const unshown = statements.filter(statement => !statement.shown).length;
  const why: string[] = [];
  if (reasons.changed !== undefined) {
    why.push(
      reasons.changed.recorded === ""
        ? "its snapshot records no checksum to show it is the file the snapshot was written with"
        : `it has changed since its snapshot was written (checksum ${short(reasons.changed.checksum)}, the snapshot recorded ${short(reasons.changed.recorded)})`
    );
  }
  if (reasons.attempt !== undefined) {
    why.push(
      reasons.attempt === "failed"
        ? "its last attempt failed"
        : "its last attempt recorded no outcome"
    );
  }
  if (trusted) {
    why.push(
      `its snapshot does not show what ${unshown === 1 ? "1 statement does" : `${unshown} statements do`}`
    );
  }
  const listed = statements.map(
    (statement, at) =>
      `  ${at + 1}. ${statement.label} (${statement.shown ? "the database has it" : "not shown by its snapshot"})`
  );
  return new NextlyError({
    code: "NEXTLY_MIGRATION_NOT_PROVEN",
    publicMessage: [
      `${filename} is pending, and the database already stands where it ends, not where it starts. It was neither run nor recorded as applied without running: ${why.join("; ")}.`,
      "Statements it would have skipped:",
      ...listed,
      `Run the statements its snapshot does not show by hand, or confirm they are not needed, then record the file with \`nextly migrate:resolve --applied ${name}\` and run \`nextly migrate\` again.`,
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
  const proven =
    reasons.changed === undefined &&
    reasons.attempt === undefined &&
    proof.statements.every(statement => statement.shown);
  if (proven) return;
  throw notProvenError({
    filename: file.filename,
    statements: proof.statements,
    reasons,
  });
}
