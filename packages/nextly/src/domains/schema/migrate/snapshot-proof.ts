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
import { standingOf } from "../events/migration-state";
import type { SchemaEventRow } from "../events/schema-events-repository";
import { rebuildCopyStatements } from "../ownership/drop-guard";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import {
  MYSQL_LIVE_RUN_LENGTH,
  mysqlLiveRunAt,
} from "../pipeline/sql-templates/mysql-live-restate";
import { literalOf } from "../pipeline/sql-templates/sqlite-swap";
import { registryRowKeys } from "../ui-schema/registry-row-keys";

import { cursorOf, StatementCursor } from "./statement-cursor";
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
  if (cursor.accept("ALTER", "TABLE")) {
    const from = cursor.name();
    if (from === undefined || !cursor.accept("RENAME")) return [];
    if (!cursor.accept("TO")) cursor.accept("AS");
    const to = cursor.name();
    return to !== undefined && cursor.done() && tables.has(to) ? [from] : [];
  }
  return [];
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

/** Whether one statement, read alone, is on the closed list (see the module comment). */
function statementShown(statement: string, file: FileContext): boolean {
  const { dialect } = file;
  const cursor = cursorOf(statement, dialect, EXACT);
  if (cursor.accept("CREATE", "TABLE")) return createTableShown(cursor, file);
  if (
    cursor.accept("CREATE", "UNIQUE", "INDEX") ||
    cursor.accept("CREATE", "INDEX")
  ) {
    return createIndexShown(cursor, file);
  }
  if (cursor.accept("DROP", "TABLE")) {
    cursor.acceptCondition();
    const names = cursor.names();
    if (!cursor.accept("CASCADE")) cursor.accept("RESTRICT");
    return (
      names !== undefined &&
      cursor.done() &&
      names.every(name => known(name, file))
    );
  }
  if (cursor.accept("DROP", "INDEX")) return dropIndexShown(cursor, file);
  if (cursor.accept("ALTER", "TABLE")) return alterTableShown(cursor, file);
  if (dialect === "mysql" && cursor.accept("RENAME", "TABLE")) {
    return renameTablesShown(cursor, file);
  }
  if (cursor.accept("INSERT", "INTO")) {
    // Rows written into a table the file created and drops again: a rebuild's guard.
    const into = cursor.name();
    return (
      into !== undefined &&
      file.created.has(into) &&
      !file.objects.tables.has(into) &&
      file.goneLater.has(into)
    );
  }
  return isSessionSetting(cursor, dialect);
}

/** `CREATE TABLE [IF NOT EXISTS] t (...)`, empty, of a table the snapshot holds or scaffolding. */
function createTableShown(cursor: StatementCursor, file: FileContext): boolean {
  cursor.acceptCondition();
  const name = cursor.name();
  if (name === undefined || !cursor.isWord("(")) return false;
  if (!createsNoRows(cursor)) return false;
  return file.objects.tables.has(name) || file.goneLater.has(name);
}

/**
 * Whether what follows a `CREATE TABLE`'s name is a body alone: no query after it (`AS`, MySQL's
 * `SELECT`, `VALUES` or `TABLE`), which would fill the table with rows.
 */
function createsNoRows(cursor: StatementCursor): boolean {
  let depth = 0;
  while (!cursor.done()) {
    const token = cursor.peek();
    if (token === "(") depth += 1;
    if (token === ")") depth -= 1;
    if (
      depth === 0 &&
      typeof token === "string" &&
      ["AS", "SELECT", "VALUES", "TABLE"].includes(token)
    ) {
      return false;
    }
    cursor.at += 1;
  }
  return true;
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
  let shown = file.objects.indexes.has(name);
  if (cursor.accept("ON")) shown = known(cursor.name(), file);
  if (!cursor.accept("CASCADE")) cursor.accept("RESTRICT");
  return shown && cursor.done();
}

/** MySQL's `RENAME TABLE a TO b[, c TO d]`. */
function renameTablesShown(
  cursor: StatementCursor,
  file: FileContext
): boolean {
  do {
    const from = cursor.name();
    if (!known(from, file) || !cursor.accept("TO")) return false;
    const to = cursor.name();
    if (to === undefined) return false;
    if (!file.objects.tables.has(to) && !file.goneLater.has(to)) return false;
  } while (cursor.accept(","));
  return cursor.done();
}

/** `ALTER TABLE [IF EXISTS] [ONLY] t <clause>[, <clause>...]`, every clause on the list. */
function alterTableShown(cursor: StatementCursor, file: FileContext): boolean {
  cursor.acceptCondition();
  if (file.dialect === "postgresql") cursor.accept("ONLY");
  const name = cursor.name();
  if (!known(name, file)) return false;
  const clauses = cursor.clauses();
  return clauses.every(tokens =>
    alterClauseShown(new StatementCursor(tokens), file, clauses.length)
  );
}

/** One `ALTER TABLE` clause: what it changes is a column, constraint, index or key, or the name. */
function alterClauseShown(
  clause: StatementCursor,
  file: FileContext,
  clauseCount: number
): boolean {
  const mysql = file.dialect === "mysql";
  if (clause.accept("ADD") || clause.accept("DROP")) {
    return elementFollows(clause, mysql);
  }
  if (clause.accept("ALTER")) {
    clause.accept("COLUMN");
    if (clause.name() === undefined) return false;
    return COLUMN_CHANGES.some(words => clause.accept(...words));
  }
  if (mysql && (clause.accept("MODIFY") || clause.accept("CHANGE"))) {
    clause.accept("COLUMN");
    return clause.name() !== undefined;
  }
  if (clause.accept("VALIDATE", "CONSTRAINT")) return !mysql;
  if (clause.accept("RENAME")) {
    if (clause.accept("TO") || clause.accept("AS")) {
      const to = clause.name();
      return (
        clauseCount === 1 &&
        clause.done() &&
        to !== undefined &&
        (file.objects.tables.has(to) || file.goneLater.has(to))
      );
    }
    if (!(mysql && (clause.accept("INDEX") || clause.accept("KEY")))) {
      clause.accept("COLUMN");
    }
    const from = clause.name();
    if (from === undefined || !clause.accept("TO")) return false;
    return clause.name() !== undefined && clause.done();
  }
  return false;
}

/**
 * What follows `ADD` or `DROP`: an element word the list names, or a column's name (a quoted name,
 * or a plain word that is not a keyword of another clause).
 */
function elementFollows(clause: StatementCursor, mysql: boolean): boolean {
  const next = clause.peek();
  if (typeof next !== "string") return clause.name() !== undefined;
  if (ELEMENT_WORDS.has(next) || (mysql && MYSQL_ELEMENT_WORDS.has(next))) {
    return true;
  }
  return /^[A-Z_][A-Z0-9_$]*$/.test(next) && !NOT_A_COLUMN.has(next);
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
  if (dialect === "sqlite" && cursor.accept("PRAGMA")) {
    const name = cursor.peek();
    return typeof name === "string" && REBUILD_PRAGMAS.has(name);
  }
  if (!cursor.accept("SET")) return false;
  if (!cursor.accept("LOCAL")) cursor.accept("SESSION");
  const name = cursor.peek();
  return typeof name === "string" && SESSION_SETTINGS.has(name);
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
 * recorded, and no unresolved attempt in its ledger rows, on any dialect.
 */
export async function refuseUnlessProven(args: {
  file: { filename: string; sha256?: string };
  proof: SnapshotProof;
  findFileApplies: (
    filename: string
  ) => Promise<
    ReadonlyArray<
      Pick<SchemaEventRow, "status" | "startedAt" | "supersededEventIds">
    >
  >;
}): Promise<void> {
  const { file, proof } = args;
  const checksum = file.sha256 ?? "";
  const reasons: UnprovenReasons = {};
  if (proof.recordedChecksum === "" || proof.recordedChecksum !== checksum) {
    reasons.changed = { checksum, recorded: proof.recordedChecksum };
  }
  const rows = (await args.findFileApplies(file.filename)).map(row => ({
    ...row,
    eventType: "file_apply" as const,
    filename: file.filename,
  }));
  const attempt = standingOf(file.filename, rows).unresolvedAttempt;
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
