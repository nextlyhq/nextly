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
 * Statements are read through the splitter's tokenizer (`statementTokens`),
 * the one reading of a statement's words, and labelled through the shared
 * scanner (`scanSql`), so a label never carries text from a string literal.
 *
 * @module domains/schema/migrate/statement-judgement
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import {
  introspectIndexTables,
  introspectLiveSnapshot,
  introspectTableNames,
} from "../pipeline/diff/introspect-live";

import { statementTokens, type QuotedToken } from "./split-sql";
import { scanSql } from "./sql-scan";

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
  /** A named FK, CHECK or UNIQUE constraint on the table (a UNIQUE constraint is also an index on PG/MySQL; count indexes too). */
  hasConstraint(table: string, name: string): boolean;
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
}

/** What a statement is, as far as the live schema can judge it. */
type Reading =
  | { kind: "schema"; claims: Claim[]; conditional: boolean }
  | { kind: "rows" }
  | { kind: "unread" };

type Token = string | QuotedToken;

const ROWS: Reading = { kind: "rows" };
const UNREAD: Reading = { kind: "unread" };

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

/** An unquoted name: a word with no qualifier and no `@` prefix. */
const BARE_NAME = /^[A-Z_][A-Z0-9_$]*$/;

/**
 * A reading position over a statement's tokens. `conditional` records that
 * an `IF [NOT] EXISTS` was read anywhere in the statement.
 */
class Cursor {
  at = 0;
  conditional = false;

  constructor(private readonly tokens: readonly Token[]) {}

  peek(offset = 0): Token | undefined {
    return this.tokens[this.at + offset];
  }

  done(): boolean {
    return this.at >= this.tokens.length;
  }

  /** Whether the next token is this keyword (an unquoted word). */
  isWord(word: string, offset = 0): boolean {
    return this.peek(offset) === word;
  }

  /** Consumes `words` when they are the next tokens, in order. */
  accept(...words: string[]): boolean {
    if (!words.every((word, i) => this.isWord(word, i))) return false;
    this.at += words.length;
    return true;
  }

  /** Consumes `IF EXISTS` or `IF NOT EXISTS` when next, and notes it. */
  acceptCondition(): void {
    if (this.accept("IF", "EXISTS") || this.accept("IF", "NOT", "EXISTS")) {
      this.conditional = true;
    }
  }

  /**
   * Consumes one unqualified name and returns it lower-cased, or undefined
   * when the next token is not a name or the name is schema-qualified
   * (`s.t`, `"s"."t"`): which schema an unqualified read reaches is not
   * something this reading decides. A string is never a name.
   */
  name(): string | undefined {
    const token = this.peek();
    let name: string | undefined;
    if (typeof token === "string") {
      if (!BARE_NAME.test(token)) return undefined;
      name = token.toLowerCase();
    } else if (token !== undefined && token.name !== undefined) {
      name = token.name.toLowerCase();
    }
    if (name === undefined) return undefined;
    this.at += 1;
    if (this.isWord(".")) return undefined;
    return name;
  }

  /** The tokens from here to the end, split at commas outside parentheses. */
  clauses(): Token[][] {
    const clauses: Token[][] = [[]];
    let depth = 0;
    for (const token of this.tokens.slice(this.at)) {
      if (token === "(") depth += 1;
      if (token === ")") depth -= 1;
      if (token === "," && depth === 0) {
        clauses.push([]);
        continue;
      }
      clauses[clauses.length - 1].push(token);
    }
    this.at = this.tokens.length;
    return clauses;
  }
}

/** A schema reading, or unread when the statement makes no claim at all. */
function schemaReading(claims: Claim[] | undefined, cursor: Cursor): Reading {
  if (claims === undefined || claims.length === 0) return UNREAD;
  return { kind: "schema", claims, conditional: cursor.conditional };
}

const table = (name: string): LiveObject => ({ kind: "table", table: name });

/**
 * One statement read into its claims. The statement's own trailing `;`, if
 * a caller left one on, is not part of its shape.
 */
function readStatement(statement: string, dialect: SupportedDialect): Reading {
  const tokens = statementTokens(statement, dialect);
  while (tokens.length > 0 && tokens[tokens.length - 1] === ";") tokens.pop();
  const cursor = new Cursor(tokens);
  const first = cursor.peek();
  if (typeof first !== "string") return UNREAD;
  if (ROW_WORDS.has(first)) return ROWS;
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
function readCreateTable(cursor: Cursor): Reading {
  cursor.acceptCondition();
  const name = cursor.name();
  if (name === undefined) return UNREAD;
  if (cursor.isWord("AS") || cursor.isWord("SELECT")) return ROWS;
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
      return ROWS;
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
  cursor: Cursor,
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
  return [{ object: { kind: "index", name, table: on }, present: true }];
}

/** `DROP TABLE [IF EXISTS] a[, b...] [CASCADE|RESTRICT]`: each absent. */
function readDropTables(cursor: Cursor): Claim[] | undefined {
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
  cursor: Cursor,
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
function readRenameTables(cursor: Cursor): Claim[] | undefined {
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
function readAlterTable(cursor: Cursor, dialect: SupportedDialect): Reading {
  cursor.acceptCondition();
  if (dialect === "postgresql") cursor.accept("ONLY");
  const name = cursor.name();
  if (name === undefined) return UNREAD;
  const clauses = cursor.clauses();
  const claims: Claim[] = [];
  for (const tokens of clauses) {
    const clause = new Cursor(tokens);
    const read = readAlterClause(clause, name, dialect, clauses.length);
    if (read === undefined) return UNREAD;
    if (clause.conditional) cursor.conditional = true;
    claims.push(...read);
  }
  return schemaReading(claims, cursor);
}

/** One clause of an `ALTER TABLE` on `on`, or undefined when unmodelled. */
function readAlterClause(
  clause: Cursor,
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
  clause: Cursor,
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
    return [{ object: { kind: "constraint", table: on, name }, present: true }];
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
  clause: Cursor,
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
  clause: Cursor,
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

/** One statement's verdict, given the keys later statements change. */
function verdictOf(
  reading: Reading,
  laterWrites: ReadonlySet<string>,
  live: LiveSchema
): Pick<JudgedStatement, "verdict" | "reason"> {
  const unknown = (reason: UnknownReason) => ({
    verdict: "unknown" as const,
    reason,
  });
  if (reading.kind === "rows") return unknown("rows");
  if (reading.kind === "unread") return unknown("unread");
  if (reading.claims.some(c => dependencies(c).some(k => laterWrites.has(k)))) {
    return unknown("undone");
  }
  const tableMissing = reading.claims.some(claim => {
    const part = tableOf(claim.object);
    return part !== undefined && !live.hasTable(part);
  });
  if (tableMissing) return unknown("no_table");
  const holding = reading.claims.filter(
    claim => liveHas(live, claim.object) === claim.present
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
 * command line reads it as the end of a sentence.
 */
function labelOf(statement: string, dialect: SupportedDialect): string {
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
  live: LiveSchema
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
 * `DROP INDEX` that names no table, and the same lookup answers for a
 * constraint backed by an index the snapshot leaves out, a primary key's.
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

  const tables = new Set(liveTables.map(name => name.toLowerCase()));
  const columns = new Set<string>();
  const indexes = new Set<string>();
  const indexesAnywhere = new Set<string>(indexTables.keys());
  const constraints = new Set<string>();
  for (const spec of snapshot.tables) {
    for (const column of spec.columns)
      columns.add(within(spec.name, column.name));
    for (const index of spec.indexes ?? []) {
      indexes.add(within(spec.name, index.name));
      indexesAnywhere.add(index.name.toLowerCase());
      constraints.add(within(spec.name, index.name));
    }
    for (const key of spec.foreignKeys ?? []) {
      constraints.add(within(spec.name, key.name));
    }
    for (const check of spec.checks ?? []) {
      constraints.add(within(spec.name, check.name));
    }
  }
  for (const [index, on] of indexTables) {
    indexes.add(within(on, index));
    constraints.add(within(on, index));
  }

  return {
    hasTable: name => tables.has(name.toLowerCase()),
    hasColumn: (on, column) => columns.has(within(on, column)),
    hasIndex: (name, on) =>
      on === undefined
        ? indexesAnywhere.has(name.toLowerCase())
        : indexes.has(within(on, name)),
    hasConstraint: (on, name) => constraints.has(within(on, name)),
  };
}
