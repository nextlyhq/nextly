/**
 * Which statements of a migration file the live database shows as done, not
 * done, or cannot show either way — judged from the live schema alone, never
 * from what the ledger recorded.
 *
 * A file that stopped part-way, on MySQL or outside a transaction, left some
 * of its statements applied and the rest not. The ledger cannot say which:
 * it records a file, not a statement. The schema can, for the statements
 * whose whole effect is the presence or absence of a named object — a table,
 * a column, an index, a constraint. Each such statement is read into CLAIMS,
 * each an object and whether the statement leaves it present, and the claims
 * are checked against the live schema.
 *
 * What the schema cannot show is reported as unknown, with the reason:
 *
 * - `rows`: the statement reads or writes rows, which the schema says nothing
 *   about.
 * - `unread`: a statement or clause this reading does not model. Reading it
 *   by guesswork would turn an unknown into a wrong answer.
 * - `undone`: a later statement of the same file changes an object this one's
 *   claims depend on, so the live state may be that statement's doing.
 * - `conditional`: written `IF [NOT] EXISTS`, with every claim holding — it
 *   may have run and found the schema so, or not run at all.
 * - `mixed`: some claims hold and some do not.
 * - `no_table`: a claim about part of a table the database does not have.
 *
 * Statements are read through the shared statement cursor (`cursorOf`, over
 * the splitter's tokenizer `statementTokens`),
 * the one reading of a statement's words, and labelled through the shared
 * scanner (`scanSql`), so a label never carries text from a string literal.
 *
 * @module domains/schema/migrate/statement-judgement
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import {
  introspectConstraintNames,
  introspectIndexTables,
  introspectUnusableIndexes,
  introspectLiveSnapshot,
  introspectTableNames,
} from "../pipeline/diff/introspect-live";

import { scanSql } from "./sql-scan";
import { cursorOf, StatementCursor } from "./statement-cursor";

export type StatementVerdict = "done" | "not_done" | "unknown";

/** Why a statement is unknown. */
export type UnknownReason =
  | "rows"
  | "unread"
  | "undone"
  | "conditional"
  | "mixed"
  | "no_table";

export interface JudgedStatement {
  /** 1-based position in the list. */
  number: number;
  /** The statement's leading text, with no string literal's content. */
  label: string;
  verdict: StatementVerdict;
  /** Set exactly when `verdict` is `unknown`. */
  reason?: UnknownReason;
}

/** The live schema facts a judgement reads. Names are compared case-folded (lower-case). */
export interface LiveSchema {
  hasTable(table: string): boolean;
  hasColumn(table: string, column: string): boolean;
  /** `table` absent: the index by name anywhere (PG/SQLite DROP INDEX names only the index). */
  hasIndex(name: string, table?: string): boolean;
  /** A named constraint on the table, of any kind, as the catalog records it. */
  hasConstraint(table: string, name: string): boolean;
  /**
   * Whether an index or constraint that is present can be used: false for a
   * PostgreSQL index left invalid or not ready, and for a PostgreSQL
   * constraint not validated. True wherever the database has no such state.
   */
  usable(object: {
    kind: "index" | "constraint";
    name: string;
    table?: string;
  }): boolean;
}

/** An object a statement leaves present or absent. Names are lower-cased. */
type LiveObject =
  | { kind: "table"; table: string }
  | { kind: "column"; table: string; column: string }
  | { kind: "index"; name: string; table?: string }
  | { kind: "constraint"; table: string; name: string };

interface Claim {
  object: LiveObject;
  present: boolean;
  /**
   * The statement makes the object usable, not only present: an index it
   * builds, a constraint it adds and validates. Such a claim holds only for
   * an object the database can use (`LiveSchema.usable`); an index a failed
   * `CREATE INDEX CONCURRENTLY` left behind, or a constraint not validated,
   * is present but not what the statement made.
   */
  usable?: boolean;
}

/**
 * What a statement is, as far as the live schema can judge it. A statement
 * read as rows or unread may still name the table it changes (`touches`): a
 * `CREATE TABLE ... AS`, or an `ALTER TABLE` with a clause this reading does
 * not model. Whatever it does there, an earlier statement's claim on that
 * table can no longer be read from the database (`judgeStatements`). One
 * whose reach is not read at all (`anything`: a procedural block, an
 * `ALTER INDEX`, a view or function, a name this reading cannot decode) may
 * have changed any object, so no earlier claim can be read after it.
 */
type Reading =
  | { kind: "schema"; claims: Claim[]; conditional: boolean }
  | { kind: "rows"; touches?: string; anything?: true }
  | { kind: "unread"; touches?: string; anything?: true };

const ROWS: Reading = { kind: "rows" };
/** A statement not read, whose reach is not known either. */
const UNREAD: Reading = { kind: "unread", anything: true };
/** A session setting or savepoint: unread, and changing no object. */
const SETTING: Reading = { kind: "unread" };

/**
 * First words of a statement that changes only the session, a savepoint or
 * the planner's statistics: it can neither make nor undo an earlier
 * statement's object.
 */
const SETTING_WORDS = new Set([
  "SET",
  "RESET",
  "PRAGMA",
  "SAVEPOINT",
  "RELEASE",
  "ANALYZE",
]);

/** Row statements that run code, which may change any object. */
const CODE_WORDS = new Set(["DO", "CALL"]);

/**
 * The first words of a statement that reads or writes rows. `SELECT` covers
 * a sequence change too (`SELECT setval(...)`): its effect is a value, not an
 * object the schema shows.
 */
const ROW_WORDS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "SELECT",
  "WITH",
  "TRUNCATE",
  "COPY",
  "CALL",
  "DO",
  "MERGE",
  "REPLACE",
  "VALUES",
  "LOAD",
]);

/**
 * Words that, after `ADD` or `DROP` in an `ALTER TABLE` clause, start
 * something other than a column. A clause that starts with one this reading
 * does not handle is unread rather than taken for a column of that name.
 */
const NON_COLUMN_WORDS = new Set([
  "CONSTRAINT",
  "UNIQUE",
  "PRIMARY",
  "FOREIGN",
  "CHECK",
  "EXCLUDE",
  "INDEX",
  "KEY",
  "FULLTEXT",
  "SPATIAL",
  "PARTITION",
  "PERIOD",
  "SYSTEM",
  "DEFAULT",
  "NOT",
  "EXPRESSION",
  "IDENTITY",
]);

/** What a named constraint can be, as the word after its name says. */
const CONSTRAINT_KINDS = new Set(["UNIQUE", "FOREIGN", "CHECK", "PRIMARY"]);

/** A schema reading, or unread when the statement makes no claim at all. */
function schemaReading(
  claims: Claim[] | undefined,
  cursor: StatementCursor
): Reading {
  if (claims === undefined || claims.length === 0) return UNREAD;
  return { kind: "schema", claims, conditional: cursor.conditional };
}

const table = (name: string): LiveObject => ({ kind: "table", table: name });

/**
 * One statement read into its claims. The statement's own trailing `;`, if
 * a caller left one on, is not part of its shape.
 */
function readStatement(statement: string, dialect: SupportedDialect): Reading {
  const cursor = cursorOf(statement, dialect);
  const first = cursor.peek();
  if (typeof first !== "string") return UNREAD;
  if (CODE_WORDS.has(first)) return { kind: "rows", anything: true };
  if (ROW_WORDS.has(first)) return ROWS;
  if (SETTING_WORDS.has(first)) return SETTING;
  if (first === "ROLLBACK" && cursor.isWord("TO", 1)) return SETTING;
  if (cursor.accept("CREATE", "TABLE")) return readCreateTable(cursor);
  if (
    cursor.accept("CREATE", "UNIQUE", "INDEX") ||
    cursor.accept("CREATE", "INDEX")
  ) {
    return schemaReading(readCreateIndex(cursor, dialect), cursor);
  }
  if (cursor.accept("DROP", "TABLE")) {
    return schemaReading(readDropTables(cursor), cursor);
  }
  if (cursor.accept("DROP", "INDEX")) {
    return schemaReading(readDropIndex(cursor, dialect), cursor);
  }
  if (cursor.accept("ALTER", "TABLE")) return readAlterTable(cursor, dialect);
  if (dialect === "mysql" && cursor.accept("RENAME", "TABLE")) {
    return schemaReading(readRenameTables(cursor), cursor);
  }
  return UNREAD;
}

/**
 * `CREATE TABLE [IF NOT EXISTS] t (...)`: t present. A table created from a
 * query (`AS`, or MySQL's `SELECT` after the column list) also writes rows;
 * any other form (`LIKE`, `OF`, `PARTITION OF`) is unread.
 */
function readCreateTable(cursor: StatementCursor): Reading {
  cursor.acceptCondition();
  const name = cursor.name();
  if (name === undefined) return UNREAD;
  if (cursor.isWord("AS") || cursor.isWord("SELECT")) {
    return { kind: "rows", touches: name };
  }
  if (!cursor.isWord("(")) return UNREAD;
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
      return { kind: "rows", touches: name };
    }
    cursor.at += 1;
  }
  return schemaReading([{ object: table(name), present: true }], cursor);
}

/**
 * `CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] n ON [ONLY] t`:
 * index n on t present. A nameless index has no name to look for.
 */
function readCreateIndex(
  cursor: StatementCursor,
  dialect: SupportedDialect
): Claim[] | undefined {
  if (dialect === "postgresql") cursor.accept("CONCURRENTLY");
  cursor.acceptCondition();
  if (cursor.isWord("ON")) return undefined;
  const name = cursor.name();
  if (name === undefined || !cursor.accept("ON")) return undefined;
  if (dialect === "postgresql") cursor.accept("ONLY");
  const on = cursor.name();
  if (on === undefined) return undefined;
  return [
    {
      object: { kind: "index", name, table: on },
      present: true,
      usable: true,
    },
  ];
}

/** `DROP TABLE [IF EXISTS] a[, b...] [CASCADE|RESTRICT]`: each absent. */
function readDropTables(cursor: StatementCursor): Claim[] | undefined {
  cursor.acceptCondition();
  const claims: Claim[] = [];
  do {
    const name = cursor.name();
    if (name === undefined) return undefined;
    claims.push({ object: table(name), present: false });
  } while (cursor.accept(","));
  if (!cursor.accept("CASCADE")) cursor.accept("RESTRICT");
  return cursor.done() ? claims : undefined;
}

/**
 * `DROP INDEX [CONCURRENTLY] [IF EXISTS] n [ON t] [CASCADE|RESTRICT]`:
 * index n absent, on t when the statement names it (MySQL always does).
 */
function readDropIndex(
  cursor: StatementCursor,
  dialect: SupportedDialect
): Claim[] | undefined {
  if (dialect === "postgresql") cursor.accept("CONCURRENTLY");
  cursor.acceptCondition();
  const name = cursor.name();
  if (name === undefined) return undefined;
  let on: string | undefined;
  if (cursor.accept("ON")) {
    on = cursor.name();
    if (on === undefined) return undefined;
  }
  if (!cursor.accept("CASCADE")) cursor.accept("RESTRICT");
  if (!cursor.done()) return undefined;
  const object: LiveObject =
    on === undefined
      ? { kind: "index", name }
      : { kind: "index", name, table: on };
  return [{ object, present: false }];
}

/** MySQL's `RENAME TABLE a TO b[, c TO d]`: each old name absent, new present. */
function readRenameTables(cursor: StatementCursor): Claim[] | undefined {
  const claims: Claim[] = [];
  do {
    const from = cursor.name();
    if (from === undefined || !cursor.accept("TO")) return undefined;
    const to = cursor.name();
    if (to === undefined) return undefined;
    claims.push(
      { object: table(from), present: false },
      { object: table(to), present: true }
    );
  } while (cursor.accept(","));
  return cursor.done() ? claims : undefined;
}

/**
 * `ALTER TABLE [IF EXISTS] [ONLY] t <clause>[, <clause>...]`. A table rename
 * (`RENAME TO|AS u`) must be the only clause: the other clauses' claims would
 * then be about a table whose name the statement itself changes. Any clause
 * this reading does not model makes the whole statement unread, since its
 * effect on the schema is then unknown.
 */
function readAlterTable(
  cursor: StatementCursor,
  dialect: SupportedDialect
): Reading {
  cursor.acceptCondition();
  if (dialect === "postgresql") cursor.accept("ONLY");
  const name = cursor.name();
  if (name === undefined) return UNREAD;
  const clauses = cursor.clauses();
  const claims: Claim[] = [];
  for (const tokens of clauses) {
    const clause = new StatementCursor(tokens);
    const read = readAlterClause(clause, name, dialect, clauses.length);
    // SQLite has no ALTER TABLE ADD or DROP CONSTRAINT and records no
    // constraint names to read, so such a clause there is unread rather than
    // judged against facts that are never present.
    const constraintOnSqlite =
      dialect === "sqlite" &&
      read?.some(claim => claim.object.kind === "constraint") === true;
    if (read === undefined || constraintOnSqlite) {
      return { kind: "unread", touches: name };
    }
    if (clause.conditional) cursor.conditional = true;
    claims.push(...read);
  }
  return schemaReading(claims, cursor);
}

/** One clause of an `ALTER TABLE` on `on`, or undefined when unmodelled. */
function readAlterClause(
  clause: StatementCursor,
  on: string,
  dialect: SupportedDialect,
  clauseCount: number
): Claim[] | undefined {
  if (clause.accept("ADD")) return readAddClause(clause, on, dialect);
  if (clause.accept("DROP")) return readDropClause(clause, on, dialect);
  if (clause.accept("RENAME")) {
    return readRenameClause(clause, on, dialect, clauseCount);
  }
  if (dialect === "mysql" && clause.accept("CHANGE")) {
    clause.accept("COLUMN");
    const from = clause.name();
    const to = clause.name();
    if (from === undefined || to === undefined || from === to) return undefined;
    return renamed(
      { kind: "column", table: on, column: from },
      {
        kind: "column",
        table: on,
        column: to,
      }
    );
  }
  return undefined;
}

/** An object renamed: the old name absent, the new one present. */
function renamed(from: LiveObject, to: LiveObject): Claim[] {
  return [
    { object: from, present: false },
    { object: to, present: true },
  ];
}

/**
 * `ADD [COLUMN] [IF NOT EXISTS] c ...`, `ADD CONSTRAINT n UNIQUE|FOREIGN
 * KEY|CHECK ...`, and MySQL's `ADD [UNIQUE] INDEX|KEY n ...`. What follows
 * the name — a column's definition, a constraint's body — does not change
 * which object is present. A primary key, and a nameless index or
 * constraint, are unread.
 */
function readAddClause(
  clause: StatementCursor,
  on: string,
  dialect: SupportedDialect
): Claim[] | undefined {
  if (clause.accept("CONSTRAINT")) {
    const next = clause.peek();
    if (typeof next === "string" && CONSTRAINT_KINDS.has(next))
      return undefined;
    const name = clause.name();
    if (name === undefined) return undefined;
    if (!["UNIQUE", "FOREIGN", "CHECK"].some(kind => clause.isWord(kind))) {
      return undefined;
    }
    // PostgreSQL's `NOT VALID` adds the constraint without checking the rows
    // already there; without it, the constraint the statement makes is a
    // validated one.
    const tokens = clause.rest();
    const notValid = tokens.at(-2) === "NOT" && tokens.at(-1) === "VALID";
    return [
      {
        object: { kind: "constraint", table: on, name },
        present: true,
        usable: !notValid,
      },
    ];
  }
  if (dialect === "mysql") {
    const unique = clause.accept("UNIQUE");
    if (clause.accept("INDEX") || clause.accept("KEY") || unique) {
      const name = clause.name();
      if (name === undefined) return undefined;
      return [{ object: { kind: "index", name, table: on }, present: true }];
    }
  }
  const explicit = clause.accept("COLUMN");
  clause.acceptCondition();
  const next = clause.peek();
  if (!explicit && typeof next === "string" && NON_COLUMN_WORDS.has(next)) {
    return undefined;
  }
  const column = clause.name();
  if (column === undefined) return undefined;
  return [{ object: { kind: "column", table: on, column }, present: true }];
}

/**
 * `DROP [COLUMN] [IF EXISTS] c`, `DROP CONSTRAINT [IF EXISTS] n`, and
 * MySQL's `DROP FOREIGN KEY n`, `DROP CHECK n` and `DROP INDEX|KEY n`, each
 * optionally followed by `CASCADE` or `RESTRICT` and nothing else.
 */
function readDropClause(
  clause: StatementCursor,
  on: string,
  dialect: SupportedDialect
): Claim[] | undefined {
  let object: LiveObject | undefined;
  if (clause.accept("CONSTRAINT")) {
    clause.acceptCondition();
    const name = clause.name();
    if (name !== undefined) object = { kind: "constraint", table: on, name };
  } else if (
    dialect === "mysql" &&
    (clause.accept("FOREIGN", "KEY") || clause.accept("CHECK"))
  ) {
    const name = clause.name();
    if (name !== undefined) object = { kind: "constraint", table: on, name };
  } else if (
    dialect === "mysql" &&
    (clause.accept("INDEX") || clause.accept("KEY"))
  ) {
    const name = clause.name();
    if (name !== undefined) object = { kind: "index", name, table: on };
  } else {
    const explicit = clause.accept("COLUMN");
    clause.acceptCondition();
    const next = clause.peek();
    if (explicit || typeof next !== "string" || !NON_COLUMN_WORDS.has(next)) {
      const column = clause.name();
      if (column !== undefined) object = { kind: "column", table: on, column };
    }
  }
  if (object === undefined) return undefined;
  if (!clause.accept("CASCADE")) clause.accept("RESTRICT");
  return clause.done() ? [{ object, present: false }] : undefined;
}

/**
 * `RENAME TO|AS u` (the table, as the only clause), `RENAME [COLUMN] a TO b`
 * (`COLUMN` optional on PostgreSQL and SQLite only; MySQL reads a bare
 * `RENAME u` as the table), and MySQL's `RENAME INDEX|KEY a TO b`.
 */
function readRenameClause(
  clause: StatementCursor,
  on: string,
  dialect: SupportedDialect,
  clauseCount: number
): Claim[] | undefined {
  if (clause.accept("TO") || clause.accept("AS")) {
    const to = clause.name();
    if (to === undefined || clauseCount !== 1 || !clause.done())
      return undefined;
    return renamed(table(on), table(to));
  }
  const index =
    dialect === "mysql" && (clause.accept("INDEX") || clause.accept("KEY"));
  if (!index && !clause.accept("COLUMN") && dialect === "mysql") {
    return undefined;
  }
  const from = clause.name();
  if (from === undefined || !clause.accept("TO")) return undefined;
  const to = clause.name();
  if (to === undefined || !clause.done()) return undefined;
  return index
    ? renamed(
        { kind: "index", name: from, table: on },
        {
          kind: "index",
          name: to,
          table: on,
        }
      )
    : renamed(
        { kind: "column", table: on, column: from },
        {
          kind: "column",
          table: on,
          column: to,
        }
      );
}

/** The table an object is part of, if it is part of one. */
function tableOf(object: LiveObject): string | undefined {
  return object.kind === "table" ? undefined : object.table;
}

/**
 * The key two statements' claims meet on. An index is keyed by its name
 * alone: PostgreSQL and SQLite name an index without its table.
 */
function keyOf(object: LiveObject): string {
  switch (object.kind) {
    case "table":
      return `table\u0000${object.table}`;
    case "column":
      return `column\u0000${object.table}\u0000${object.column}`;
    case "index":
      return `index\u0000${object.name}`;
    case "constraint":
      return `constraint\u0000${object.table}\u0000${object.name}`;
  }
}

/** What a claim's truth depends on: its object, and the table it is part of. */
function dependencies(claim: Claim): string[] {
  const part = tableOf(claim.object);
  return part === undefined
    ? [keyOf(claim.object)]
    : [keyOf(claim.object), keyOf(table(part))];
}

/** Whether the live schema has the object. */
function liveHas(live: LiveSchema, object: LiveObject): boolean {
  switch (object.kind) {
    case "table":
      return live.hasTable(object.table);
    case "column":
      return live.hasColumn(object.table, object.column);
    case "index":
      return live.hasIndex(object.name, object.table);
    case "constraint":
      return live.hasConstraint(object.table, object.name);
  }
}

/**
 * Whether the live schema shows a claim. A claim of absence holds only when
 * the object is gone, so an unusable object still counts as there; a claim
 * that the statement made a usable object holds only when it is usable.
 */
function claimHolds(live: LiveSchema, claim: Claim): boolean {
  const has = liveHas(live, claim.object);
  if (!claim.present) return !has;
  if (!has || claim.usable !== true) return has;
  const { object } = claim;
  return object.kind === "index" || object.kind === "constraint"
    ? live.usable(object)
    : true;
}

/** The key of a later statement that may have changed any object. */
const ANYTHING = "anything";

/** One statement's verdict, given the keys later statements change. */
function verdictOf(
  reading: Reading,
  laterWrites: ReadonlySet<string>,
  live: LiveSchema | undefined
): Pick<JudgedStatement, "verdict" | "reason"> {
  const unknown = (reason: UnknownReason) => ({
    verdict: "unknown" as const,
    reason,
  });
  if (reading.kind === "rows") return unknown("rows");
  if (reading.kind === "unread") return unknown("unread");
  if (
    laterWrites.has(ANYTHING) ||
    reading.claims.some(c => dependencies(c).some(k => laterWrites.has(k)))
  ) {
    return unknown("undone");
  }
  if (live === undefined) return unknown("unread");
  const tableMissing = reading.claims.some(claim => {
    const part = tableOf(claim.object);
    return part !== undefined && !live.hasTable(part);
  });
  if (tableMissing) return unknown("no_table");
  const holding = reading.claims.filter(claim =>
    claimHolds(live, claim)
  ).length;
  if (holding === reading.claims.length) {
    return reading.conditional ? unknown("conditional") : { verdict: "done" };
  }
  if (holding === 0) return { verdict: "not_done" };
  return unknown("mixed");
}

/** Longest label, in characters, the ellipsis included. */
const LABEL_LIMIT = 60;

/**
 * A statement's leading text, for a person to find it by: its code and
 * quoted names as written, comments skipped, up to the first string literal,
 * dollar-quoted body or `(`. A string literal can hold row data, so nothing
 * from one ever reaches a label; an unterminated quoted name, which runs over
 * whatever follows it, stops the label too. A `. ` is closed up because the
 * command line reads it as the end of a sentence. Exported so a refusal that
 * names the statements of a file labels them as this judgement does.
 */
export function labelOf(statement: string, dialect: SupportedDialect): string {
  let text = "";
  for (const segment of scanSql(statement, dialect)) {
    if (segment.kind === "line-comment" || segment.kind === "block-comment") {
      text += " ";
      continue;
    }
    if (segment.kind === "quoted-name" && !segment.unterminated) {
      text += statement.slice(segment.start, segment.end);
      continue;
    }
    if (segment.kind !== "code") break;
    const code = statement.slice(segment.start, segment.end);
    const paren = code.indexOf("(");
    text += paren === -1 ? code : code.slice(0, paren);
    if (paren !== -1) break;
  }
  const label = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/;+$/, "")
    .trimEnd()
    .replace(/\. /g, ".");
  return label.length > LABEL_LIMIT
    ? `${label.slice(0, LABEL_LIMIT - 1).trimEnd()}…`
    : label;
}

/**
 * Each statement's verdict against the live schema, in order. Rule order:
 * a statement a later one may have undone is unknown; then one about part of
 * a missing table; then done when every claim holds (unknown when written
 * conditionally), not done when none does, and unknown when only some do.
 * Pure: reads only `live`.
 */
export function judgeStatements(
  statements: readonly string[],
  dialect: SupportedDialect,
  /** Absent when the live schema could not be read: no claim can be judged. */
  live: LiveSchema | undefined
): JudgedStatement[] {
  const readings = statements.map(statement =>
    readStatement(statement, dialect)
  );
  // The keys each statement's successors change, built from the end so each
  // statement's set is its successor's plus that successor's own writes.
  const laterWrites: Array<ReadonlySet<string>> = new Array(readings.length);
  let after = new Set<string>();
  for (let i = readings.length - 1; i >= 0; i -= 1) {
    laterWrites[i] = after;
    const reading = readings[i];
    if (reading.kind === "schema") {
      after = new Set([...after, ...reading.claims.map(c => keyOf(c.object))]);
    } else if (reading.anything === true) {
      after = new Set([...after, ANYTHING]);
    } else if (reading.touches !== undefined) {
      after = new Set([...after, keyOf(table(reading.touches))]);
    }
  }
  return readings.map((reading, i) => ({
    number: i + 1,
    label: labelOf(statements[i], dialect),
    ...verdictOf(reading, laterWrites[i], live),
  }));
}

/** Lower-cased names, each once. */
function distinct(names: Iterable<string>): string[] {
  return [...new Set([...names].map(name => name.toLowerCase()))];
}

/** A key for a name within a table, lower-cased. */
const within = (table: string, name: string): string =>
  `${table.toLowerCase()}\u0000${name.toLowerCase()}`;

/**
 * Reads, once, every fact `judgeStatements` will ask about these statements.
 * Read-only.
 *
 * The tables the claims name are found without regard to case
 * (`introspectTableNames`), then described by the diff's own reading
 * (`introspectLiveSnapshot`): columns, indexes, foreign keys and checks, the
 * constraint names as the catalog holds them. On PostgreSQL and SQLite an
 * index is also looked up by name alone (`introspectIndexTables`), for a
 * `DROP INDEX` that names no table. A constraint is whatever the catalog
 * records as one on the table (`introspectConstraintNames`).
 */
export async function readLiveSchema(
  db: unknown,
  dialect: SupportedDialect,
  statements: readonly string[]
): Promise<LiveSchema> {
  const objects = statements.flatMap(statement => {
    const reading = readStatement(statement, dialect);
    return reading.kind === "schema" ? reading.claims.map(c => c.object) : [];
  });
  // Every table a claim is about or is part of; the latter decides `no_table`.
  const tableNames = distinct(
    objects.flatMap(o => {
      const name = o.kind === "table" ? o.table : tableOf(o);
      return name === undefined ? [] : [name];
    })
  );
  const indexNames = distinct(
    objects.flatMap(o =>
      o.kind === "index" || o.kind === "constraint" ? [o.name] : []
    )
  );

  const liveTables = await introspectTableNames(db, dialect, tableNames);
  const snapshot = await introspectLiveSnapshot(db, dialect, liveTables);
  const indexTables = await introspectIndexTables(db, dialect, indexNames);
  // Every constraint by the catalog's own record of it, primary keys and
  // exclusion constraints included: inferred from the snapshot's indexes,
  // foreign keys and checks, a primary key read as absent, and a statement
  // dropping one that never ran read as done.
  const constraintNames = await introspectConstraintNames(
    db,
    dialect,
    liveTables
  );

  const tables = new Set(liveTables.map(name => name.toLowerCase()));
  const columns = new Set<string>();
  const indexes = new Set<string>();
  const indexesAnywhere = new Set<string>(indexTables.keys());
  const unusableIndexes = await introspectUnusableIndexes(
    db,
    dialect,
    liveTables
  );
  const constraints = new Set<string>();
  const unvalidated = new Set<string>();
  for (const [on, names] of constraintNames) {
    for (const [name, validated] of names) {
      constraints.add(within(on, name));
      if (!validated) unvalidated.add(within(on, name));
    }
  }
  for (const spec of snapshot.tables) {
    for (const column of spec.columns)
      columns.add(within(spec.name, column.name));
    for (const index of spec.indexes ?? []) {
      indexes.add(within(spec.name, index.name));
      indexesAnywhere.add(index.name.toLowerCase());
    }
  }
  for (const [index, on] of indexTables) {
    indexes.add(within(on, index));
  }

  return {
    hasTable: name => tables.has(name.toLowerCase()),
    hasColumn: (on, column) => columns.has(within(on, column)),
    hasIndex: (name, on) =>
      on === undefined
        ? indexesAnywhere.has(name.toLowerCase())
        : indexes.has(within(on, name)),
    hasConstraint: (on, name) => constraints.has(within(on, name)),
    usable: object =>
      object.kind === "index"
        ? !unusableIndexes.has(object.name.toLowerCase())
        : !unvalidated.has(within(object.table ?? "", object.name)),
  };
}
