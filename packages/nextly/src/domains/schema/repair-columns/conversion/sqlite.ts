// How one column converts on SQLite: a rebuild of its table that changes only the column's declared
// type and its NOT NULL.
//
// SQLite cannot change a column's type in place, and only recent versions can drop a NOT NULL in
// place (3.53 can, the 3.38 floor cannot), so every conversion rebuilds the table, whatever the
// change, with no version detection. The rebuilt table is declared from the live table's own
// stored CREATE TABLE statement, edited at exactly two places in the converted column's
// definition: its declared type and its NOT NULL constraint. Everything else in the statement
// stays as written, so the other columns, defaults, collations, checks, keys, generated columns,
// comments and table options come back as they were. The swap (`pipeline/sql-templates/
// sqlite-swap`) then puts back the indexes and triggers the drop takes and the views and other
// tables' triggers that read the table, each from its stored SQL.
//
// The rebuild keeps each check and index as written, so where the column's kind of value changes
// (a string becoming a number), a check or an index expression or predicate that reads the column
// would be read against the new type, and is named instead: the same rule PostgreSQL and MySQL
// keep. A foreign key is not: SQLite compares its two ends by value, whatever their types.
//
// The rebuild runs in one transaction, which holds SQLite's write lock: other connections' reads
// continue and their writes wait.
//
// The facts are read in `readSqliteTableFacts`; everything after is pure (`planSqliteConversion`).
//
// @module domains/schema/repair-columns/conversion/sqlite

import { sql } from "drizzle-orm";

import { NextlyError } from "../../../../errors/nextly-error";
import { scanSql } from "../../migrate/sql-scan";
import { querySqlRows } from "../../pipeline/classifier/count-helpers";
import {
  sqliteForeignKeysOffGuard,
  sqliteSwapStatements,
} from "../../pipeline/sql-templates/sqlite-swap";
import { sqliteAffinity } from "../../value-conversion/column-type";
import type { ColumnState } from "../types";

import {
  OWNER_CAN,
  PRIMARY_KEY_OWNER_CAN,
  UNIQUE_KEY_OWNER_CAN,
  checkRefusals,
  expressionIndexRefusal,
  kindChanges,
  renderedType,
  typeChanges,
} from "./carry";
import type {
  CannotCarry,
  ColumnConversionPlan,
  ConversionRequest,
} from "./types";

/** A view or trigger, as `sqlite_schema` stores it. */
interface SqliteSchemaObject {
  type: "view" | "trigger";
  name: string;
  /** The table or view a trigger is on; a view's own name for a view. */
  tableName: string;
  sql: string;
}

/** What the conversion reads from the live table. */
export interface SqliteTableFacts {
  /** The table's stored CREATE TABLE statement. */
  createSql: string;
  /** Every column, in the table's order (`pragma_table_xinfo`). */
  columns: readonly {
    name: string;
    generated: boolean;
    primaryKey: boolean;
    /** A generated column whose value is stored, not computed on each read. */
    storedGenerated?: boolean;
  }[];
  /** The table's CREATE INDEX statements: the indexes it was given, not its UNIQUE constraints'. */
  indexes: readonly string[];
  /** Every view and trigger in the schema, in the order they were stored. */
  objects: readonly SqliteSchemaObject[];
  /** The table's UNIQUE keys but its primary key: each by its name, and its columns. */
  uniqueKeys: readonly { name: string; columns: readonly string[] }[];
  /**
   * The foreign keys out of the table and into it from other tables, each by a name that shows
   * both ends, with the column of this table it compares.
   */
  foreignKeys: readonly { name: string; column: string }[];
}

/** The plan for converting `request`'s column on SQLite, read from the live table through `db`. */
export async function buildSqliteConversion(
  db: unknown,
  request: ConversionRequest
): Promise<ColumnConversionPlan> {
  return planSqliteConversion(
    await readSqliteTableFacts(db, request.table),
    request
  );
}

/** Reads `table`'s stored statement, columns and indexes, and every view and trigger. */
async function readSqliteTableFacts(
  db: unknown,
  table: string
): Promise<SqliteTableFacts> {
  const [stored] = await querySqlRows<{ sql: string | null }>(
    db,
    "sqlite",
    sql`SELECT sql FROM sqlite_schema WHERE type = 'table' AND lower(name) = lower(${table})`
  );
  if (stored?.sql == null) {
    throw NextlyError.internal({
      logContext: { reason: "sqlite-conversion-table-not-found", table },
    });
  }
  // `hidden` 2 and 3 mark a virtual and a stored generated column.
  const columns = await querySqlRows<{
    name: string;
    hidden: number;
    pk: number;
  }>(
    db,
    "sqlite",
    sql`SELECT name, hidden, pk FROM pragma_table_xinfo(${table}) ORDER BY cid`
  );
  // An index SQLite made for a UNIQUE or PRIMARY KEY constraint has no SQL of its own: the
  // constraint is in the table's statement, which the rebuilt table keeps.
  const indexes = await querySqlRows<{ sql: string }>(
    db,
    "sqlite",
    sql`SELECT sql FROM sqlite_schema WHERE type = 'index' AND lower(tbl_name) = lower(${table}) AND sql IS NOT NULL ORDER BY rowid`
  );
  const objects = await querySqlRows<SqliteSchemaObject>(
    db,
    "sqlite",
    sql`SELECT type, name, tbl_name AS tableName, sql FROM sqlite_schema WHERE type IN ('view', 'trigger') AND sql IS NOT NULL ORDER BY rowid`
  );
  const primaryKey = columns.find(column => column.pk === 1)?.name ?? "";
  return {
    createSql: stored.sql,
    columns: columns.map(column => ({
      name: column.name,
      generated: column.hidden === 2 || column.hidden === 3,
      primaryKey: column.pk > 0,
      storedGenerated: column.hidden === 3,
    })),
    indexes: indexes.map(index => index.sql),
    objects,
    uniqueKeys: await readSqliteUniqueKeys(db, table),
    foreignKeys: await readSqliteForeignKeys(db, table, primaryKey),
  };
}

/**
 * The table's UNIQUE keys, from SQLite's own index list: an inline or table `UNIQUE` named by its
 * columns, a `CREATE UNIQUE INDEX` by its name. The primary key is judged on its own.
 */
async function readSqliteUniqueKeys(
  db: unknown,
  table: string
): Promise<SqliteTableFacts["uniqueKeys"]> {
  const rows = await querySqlRows<{
    indexName: string;
    origin: string;
    columnName: string | null;
  }>(
    db,
    "sqlite",
    sql`SELECT il.name AS indexName, il.origin AS origin, ii.name AS columnName
        FROM pragma_index_list(${table}) il JOIN pragma_index_info(il.name) ii
        WHERE il."unique" = 1 AND il.origin <> 'pk'
        ORDER BY il.seq DESC, ii.seqno`
  );
  const keys = new Map<string, { origin: string; columns: string[] }>();
  for (const row of rows) {
    const key = keys.get(row.indexName) ?? { origin: row.origin, columns: [] };
    if (row.columnName !== null) key.columns.push(row.columnName);
    keys.set(row.indexName, key);
  }
  return [...keys].map(([indexName, key]) => ({
    name: key.origin === "u" ? `UNIQUE (${key.columns.join(", ")})` : indexName,
    columns: key.columns,
  }));
}

/**
 * The foreign keys out of the table, then those into it from every other table, each named
 * `child (column) REFERENCES parent (column)`. A key that names no parent column references the
 * parent's primary key.
 */
async function readSqliteForeignKeys(
  db: unknown,
  table: string,
  primaryKey: string
): Promise<SqliteTableFacts["foreignKeys"]> {
  const ends = (to: string | null): string => (to === null ? "" : ` (${to})`);
  const out = await querySqlRows<{
    parent: string;
    fromColumn: string;
    toColumn: string | null;
  }>(
    db,
    "sqlite",
    sql`SELECT "table" AS parent, "from" AS fromColumn, "to" AS toColumn
        FROM pragma_foreign_key_list(${table}) ORDER BY id, seq`
  );
  const into = await querySqlRows<{
    child: string;
    fromColumn: string;
    toColumn: string | null;
  }>(
    db,
    "sqlite",
    sql`SELECT m.name AS child, f."from" AS fromColumn, f."to" AS toColumn
        FROM sqlite_schema m JOIN pragma_foreign_key_list(m.name) f
        WHERE m.type = 'table' AND lower(f."table") = lower(${table})
        ORDER BY m.name, f.id, f.seq`
  );
  return [
    ...out.map(key => ({
      name: `${table} (${key.fromColumn}) REFERENCES ${key.parent}${ends(key.toColumn)}`,
      column: key.fromColumn,
    })),
    ...into.map(key => ({
      name: `${key.child} (${key.fromColumn}) REFERENCES ${table}${ends(key.toColumn)}`,
      column: key.toColumn ?? primaryKey,
    })),
  ];
}

/** How the conversion of `request`'s column rebuilds the table `facts` describe. Changes nothing. */
export function planSqliteConversion(
  facts: SqliteTableFacts,
  request: ConversionRequest
): ColumnConversionPlan {
  // SQLite holds JSON as text, so a component's list of references never changes its column's type
  // here and never takes the list conversion.
  if (request.referenceList === true) {
    throw NextlyError.internal({
      logContext: {
        reason: "sqlite-conversion-reference-list",
        table: request.table,
        column: request.column,
      },
    });
  }
  const plan = (
    steps: string[][],
    cannotCarry: CannotCarry[]
  ): ColumnConversionPlan => ({
    steps,
    rewritesTable: true,
    blocks: "writes",
    cannotCarry,
    notCarried: [],
  });
  const definition = retypedDefinition(
    facts.createSql,
    request.column,
    request.to
  );
  if (definition === undefined) {
    // Without a definition there is nothing to rebuild from.
    return plan(
      [],
      [
        {
          property: "definition",
          name: request.column,
          reason:
            "the table's stored CREATE TABLE statement cannot be read safely at this column, so a rebuild cannot show that it keeps the column's default, collation and checks",
          ownerCan: `convert the column in a manual migration (nextly migrate:create --blank) that recreates ${request.table}`,
        },
      ]
    );
  }
  // Only a type change can change what the key is: a nullability change keeps the declared type,
  // and with it whether the key is the table's rowid.
  const cannotCarry: CannotCarry[] = facts.columns
    .filter(
      column =>
        typeChanges(request) &&
        column.primaryKey &&
        column.name.toLowerCase() === request.column.toLowerCase()
    )
    .map(column => ({
      property: "key",
      name: column.name,
      reason:
        "the column is in the table's primary key, and its declared type decides whether the key is the table's rowid, so retyping it changes what the key is",
      ownerCan: PRIMARY_KEY_OWNER_CAN,
    }));
  // A STRICT table takes only its own type names, and refuses the rebuilt table's CREATE otherwise:
  // said here, before anything runs, rather than as a failed rebuild.
  if (
    isStrict(facts.createSql) &&
    !STRICT_TYPES.has(request.to.type.trim().toUpperCase())
  ) {
    cannotCarry.push({
      property: "definition",
      name: request.column,
      reason: `${request.table} is a STRICT table, which takes only the types ${[...STRICT_TYPES].join(", ")}, not ${request.to.type}`,
      ownerCan: `declare the field so its column is one of those types, or convert ${request.table} in a manual migration (nextly migrate:create --blank)`,
    });
  }
  if (kindChanges(request)) {
    cannotCarry.push(...kindChangeRefusals(facts, request));
  }
  if (typeChanges(request)) {
    cannotCarry.push(...storedGeneratedRefusals(facts, request));
  }
  cannotCarry.push(...affinityKeyRefusals(facts, request));
  const readers = readersOf(request.table, facts.objects);
  const statements = sqliteSwapStatements({
    table: request.table,
    definition,
    // A generated column cannot be written: the new table computes it again from the others.
    columns: facts.columns
      .filter(column => !column.generated)
      .map(column => column.name),
    indexes: facts.indexes,
    triggers: readers.triggers,
    views: readers.views,
    dependentTriggers: readers.dependentTriggers,
    keepsSequence: significant(tokenize(facts.createSql) ?? []).some(token =>
      isWord(token, "AUTOINCREMENT")
    ),
  });
  // With foreign keys on, the swap's DROP TABLE would run every referencing table's ON DELETE action,
  // so the step first refuses unless they are off, before anything is dropped.
  const guard = sqliteForeignKeysOffGuard(
    request.table,
    `converting ${request.table}.${request.column} rebuilds ${request.table}, which needs foreign keys off: run it with foreign keys off, as nextly's migration runner does`
  );
  return plan([[...guard, ...statements]], cannotCarry);
}

/**
 * The checks and indexes that read the column in an expression, which a change of the kind of
 * value would have read against the new type: each check in the table's statement whose expression
 * names the column, then each index with a key expression or a WHERE predicate that names it. A
 * key on the column as it is, with its collation and order, reads no expression and is kept.
 */
function kindChangeRefusals(
  facts: SqliteTableFacts,
  request: ConversionRequest
): CannotCarry[] {
  const to = renderedType(request.to);
  const checks = checksReading(facts.createSql, request.column).map(name => ({
    name,
  }));
  const indexes = facts.indexes.flatMap(indexSql => {
    const name = indexReadingInExpression(indexSql, request.column);
    return name === undefined ? [] : [expressionIndexRefusal(name, to)];
  });
  return [...checkRefusals(checks, to), ...indexes];
}

/**
 * The stored generated columns that read the column, directly or through other generated columns
 * (`s AS (v) STORED` over `v AS (typeof(c)) VIRTUAL`). The rebuild computes each again from the
 * converted values, so a value that reads the column's type would change in place: the same rule
 * PostgreSQL keeps, where any type change under one is refused. A virtual column stores nothing;
 * it is computed on each read, as any query over the column is.
 */
function storedGeneratedRefusals(
  facts: SqliteTableFacts,
  request: ConversionRequest
): CannotCarry[] {
  const expressions = generatedExpressions(facts);
  // Until no further generated column is found reading the column or one already found.
  const reading = new Set<string>();
  const readsAny = (tokens: readonly Token[]): boolean =>
    namesColumn(tokens, request.column) ||
    [...reading].some(name => namesColumn(tokens, name));
  for (let grew = true; grew; ) {
    grew = false;
    for (const expression of expressions) {
      if (reading.has(expression.name) || !readsAny(expression.tokens))
        continue;
      reading.add(expression.name);
      grew = true;
    }
  }
  return expressions
    .filter(expression => expression.stored && reading.has(expression.name))
    .map(expression => ({
      property: "generated column",
      name: expression.name,
      reason:
        "the stored generated column is computed from this column, and the rebuild would compute it again from the converted values, changing what it stores",
      ownerCan: OWNER_CAN["generated column"],
    }));
}

/** Each generated column's expression, as tokens, from the table's stored statement. */
function generatedExpressions(
  facts: SqliteTableFacts
): { name: string; stored: boolean; tokens: Token[] }[] {
  const generated = new Map(
    facts.columns
      .filter(column => column.generated)
      .map(column => [
        column.name.toLowerCase(),
        column.storedGenerated === true,
      ])
  );
  const words = significant(tokenize(facts.createSql) ?? []);
  const open = columnListStart(words);
  const items = open === undefined ? undefined : columnListItems(words, open);
  return (items ?? []).flatMap(item => {
    const name = item[0] === undefined ? "" : identifierOf(item[0]);
    const stored = generated.get(name.toLowerCase());
    const as = item.findIndex(
      (token, k) => isWord(token, "AS") && isPunct(item[k + 1], "(")
    );
    const close = as < 0 ? undefined : closingParen(item, as + 1);
    return stored === undefined || close === undefined
      ? []
      : [{ name, stored, tokens: item.slice(as + 2, close) }];
  });
}

/**
 * The unique keys and foreign keys on the column, where its affinity changes. Each compares the
 * stored values, and a new affinity stores some of them differently: as INTEGER, '1' and '01' both
 * become 1, so a unique key that held them apart would collide, and a key would compare its two
 * ends differently. Judged from the catalog, reading no row.
 */
function affinityKeyRefusals(
  facts: SqliteTableFacts,
  request: ConversionRequest
): CannotCarry[] {
  // Judged by the same affinity rule the row conversion uses.
  const from = sqliteAffinity(request.from.type);
  const to = sqliteAffinity(request.to.type);
  if (from === to) return [];
  const isColumn = (name: string): boolean =>
    name.toLowerCase() === request.column.toLowerCase();
  const change = `the change from ${from} to ${to} affinity`;
  return [
    ...facts.uniqueKeys
      .filter(key => key.columns.some(isColumn))
      .map(
        (key): CannotCarry => ({
          property: "key",
          name: key.name,
          reason: `the unique key compares the column's stored values, and ${change} can store two values it holds apart as one (as INTEGER, '1' and '01' both become 1)`,
          ownerCan: UNIQUE_KEY_OWNER_CAN,
        })
      ),
    ...facts.foreignKeys
      .filter(key => isColumn(key.column))
      .map(
        (key): CannotCarry => ({
          property: "key",
          name: key.name,
          reason: `the foreign key compares the column's stored values with its other end, and ${change} can store a value that no longer matches it`,
          ownerCan: OWNER_CAN.key,
        })
      ),
  ];
}

/** Whether any name among `tokens` is `column`, case-folded as SQLite resolves names. */
function namesColumn(tokens: readonly Token[], column: string): boolean {
  const wanted = column.toLowerCase();
  return tokens.some(
    token =>
      (token.kind === "word" || token.kind === "quoted") &&
      identifierOf(token).toLowerCase() === wanted
  );
}

/** The index of the parenthesis that closes the one at `open`, or undefined. */
function closingParen(
  words: readonly Token[],
  open: number
): number | undefined {
  let depth = 0;
  for (let k = open; k < words.length; k += 1) {
    if (isPunct(words[k], "(")) depth += 1;
    if (isPunct(words[k], ")")) {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return undefined;
}

/**
 * The checks in a CREATE TABLE statement whose expression names `column`, each by its
 * `CONSTRAINT` name, or as written where it has none.
 */
function checksReading(createSql: string, column: string): string[] {
  const words = significant(tokenize(createSql) ?? []);
  const names: string[] = [];
  for (let k = 0; k < words.length; k += 1) {
    if (!isWord(words[k], "CHECK") || !isPunct(words[k + 1], "(")) continue;
    const close = closingParen(words, k + 1);
    if (close === undefined) continue;
    if (!namesColumn(words.slice(k + 2, close), column)) continue;
    names.push(
      k >= 2 && isWord(words[k - 2], "CONSTRAINT")
        ? identifierOf(words[k - 1])
        : createSql.slice(words[k].start, words[close].end)
    );
  }
  return names;
}

/**
 * The name of a CREATE INDEX statement's index where a key expression or its WHERE predicate names
 * `column`, or undefined where it does not. A statement that cannot be read is named as written,
 * since whether it reads the column cannot be told.
 */
function indexReadingInExpression(
  indexSql: string,
  column: string
): string | undefined {
  const parts = indexParts(indexSql);
  if (parts === undefined) return indexSql;
  const reads =
    parts.keys.some(key => isExpressionKey(key) && namesColumn(key, column)) ||
    namesColumn(parts.predicate, column);
  return reads ? parts.name : undefined;
}

/**
 * A CREATE INDEX statement's index name, its keys (each its tokens) and the tokens of its WHERE
 * predicate, or undefined where the statement cannot be read that far.
 */
function indexParts(
  indexSql: string
): { name: string; keys: Token[][]; predicate: Token[] } | undefined {
  const words = significant(tokenize(indexSql) ?? []);
  const on = words.findIndex(token => isWord(token, "ON"));
  const open = words.findIndex((token, k) => k > on && isPunct(token, "("));
  const close = open < 0 ? undefined : closingParen(words, open);
  // The key list splits as a table's column list does: at its top-level commas.
  const keys =
    close === undefined ? undefined : columnListItems(words, words[open]);
  if (on < 1 || close === undefined || keys === undefined) return undefined;
  return {
    name: identifierOf(words[on - 1]),
    keys,
    predicate: words.slice(close + 1),
  };
}

/** Whether an index key is an expression, not a column with its COLLATE and ASC or DESC. */
function isExpressionKey(key: readonly Token[]): boolean {
  const [first] = key;
  if (
    first === undefined ||
    (first.kind !== "word" && first.kind !== "quoted")
  ) {
    return true;
  }
  for (let k = 1; k < key.length; ) {
    if (isWord(key[k], "COLLATE")) k += 2;
    else if (isWord(key[k], "ASC") || isWord(key[k], "DESC")) k += 1;
    else return true;
  }
  return false;
}

/** The type names a STRICT table accepts (SQLite's STRICT tables documentation). */
const STRICT_TYPES = new Set(["INT", "INTEGER", "REAL", "TEXT", "BLOB", "ANY"]);

/** Whether the stored statement declares the table STRICT, among the options after its columns. */
function isStrict(createSql: string): boolean {
  const words = significant(tokenize(createSql) ?? []);
  const open = columnListStart(words);
  if (open === undefined) return false;
  let depth = 0;
  for (let k = words.indexOf(open) + 1; k < words.length; k += 1) {
    if (isPunct(words[k], "(")) depth += 1;
    else if (isPunct(words[k], ")")) {
      if (depth === 0) {
        return words.slice(k + 1).some(token => isWord(token, "STRICT"));
      }
      depth -= 1;
    }
  }
  return false;
}

/**
 * The table's own triggers, and the views and triggers elsewhere that read it, which the swap has
 * to drop and create again.
 *
 * Whether one reads the table is judged from its SQL by name, case-folded as SQLite resolves names:
 * any view or trigger that names the table, or names a view already found, counts. A name that only
 * appears inside a longer one or a string literal counts too; such a view is dropped and created
 * again from its own SQL, unchanged, which costs nothing, while one missed would make SQLite refuse
 * the swap. A trigger on a view found is counted too: dropping the view would take it.
 */
function readersOf(
  table: string,
  objects: readonly SqliteSchemaObject[]
): {
  triggers: string[];
  views: { name: string; sql: string }[];
  dependentTriggers: { name: string; sql: string }[];
} {
  const lower = table.toLowerCase();
  const names = [lower];
  const views = new Set<string>();
  const mentionsAny = (sqlText: string): boolean => {
    const text = sqlText.toLowerCase();
    return names.some(name => text.includes(name));
  };
  // Until no further view is found: a view reading a found view reads the table through it.
  for (let found = true; found; ) {
    found = false;
    for (const object of objects) {
      const name = object.name.toLowerCase();
      if (
        object.type !== "view" ||
        views.has(name) ||
        !mentionsAny(object.sql)
      ) {
        continue;
      }
      views.add(name);
      names.push(name);
      found = true;
    }
  }
  const own = (object: SqliteSchemaObject): boolean =>
    object.tableName.toLowerCase() === lower;
  return {
    triggers: objects
      .filter(object => object.type === "trigger" && own(object))
      .map(object => object.sql),
    views: objects
      .filter(
        object => object.type === "view" && views.has(object.name.toLowerCase())
      )
      .map(({ name, sql: text }) => ({ name, sql: text })),
    dependentTriggers: objects
      .filter(
        object =>
          object.type === "trigger" &&
          !own(object) &&
          (views.has(object.tableName.toLowerCase()) || mentionsAny(object.sql))
      )
      .map(({ name, sql: text }) => ({ name, sql: text })),
  };
}

/** A token of a SQLite statement, with where it stands in the text. */
interface Token {
  kind: "space" | "comment" | "string" | "quoted" | "word" | "punct";
  text: string;
  start: number;
  end: number;
  /** A string's or quoted name's content, its quotes removed and a doubled quote undone. */
  content?: string;
}

/** A type name a column can be declared with: words, and a size of one or two numbers. */
const TYPE_NAME =
  /^[A-Za-z_][A-Za-z0-9_ ]*(\(\s*[0-9]+\s*(,\s*[0-9]+\s*)?\))?$/;

/** The words a table constraint starts with, where a column definition would start with its name. */
const TABLE_CONSTRAINT_START = new Set([
  "CONSTRAINT",
  "PRIMARY",
  "UNIQUE",
  "CHECK",
  "FOREIGN",
]);

/** The words a column constraint starts with, which end the column's declared type. */
const COLUMN_CONSTRAINT_START = new Set([
  "CONSTRAINT",
  "PRIMARY",
  "NOT",
  "NULL",
  "UNIQUE",
  "CHECK",
  "DEFAULT",
  "COLLATE",
  "REFERENCES",
  "GENERATED",
  "AS",
]);

/**
 * What a CREATE TABLE statement holds after the table's name — its column list and table options —
 * with `column`'s declared type set to `to.type` and its NOT NULL to match `to.nullable`, and every
 * other character as written. Undefined where the statement cannot be read safely at the column:
 * an unclosed quote, no column list, or the column not found exactly once.
 *
 * The type is replaced only when it differs from the one written (case and spacing aside), so a
 * nullability change leaves it as written. Dropping NOT NULL removes each NOT NULL constraint of
 * the column, with its `CONSTRAINT name` and `ON CONFLICT` clause; a NOT NULL inside parentheses
 * (a check, a default's expression) is another clause's and is left alone. Adding it appends
 * ` NOT NULL` to the column's definition.
 */
function retypedDefinition(
  createSql: string,
  column: string,
  to: ColumnState
): string | undefined {
  // The type is written into the statement, so it is held to the shape of a type name.
  if (!TYPE_NAME.test(to.type.trim())) {
    throw NextlyError.internal({
      logContext: { reason: "sqlite-conversion-type-name", type: to.type },
    });
  }
  const tokens = tokenize(createSql);
  if (tokens === undefined) return undefined;
  const found = columnItem(significant(tokens), column);
  if (found === undefined) return undefined;
  const [name, ...rest] = found.item;
  const typeEnd = firstAtDepthZero(
    rest,
    token =>
      token.kind === "word" &&
      COLUMN_CONSTRAINT_START.has(token.text.toUpperCase())
  );
  const edits = [
    ...typeEdits(createSql, name, rest.slice(0, typeEnd), to.type),
    ...nullabilityEdits(tokens, found.item, rest.slice(typeEnd), to.nullable),
  ];
  const edited = [...edits]
    .sort((x, y) => y.start - x.start)
    .reduce(
      (text, edit) =>
        text.slice(0, edit.start) + edit.text + text.slice(edit.end),
      createSql
    );
  // Every edit lies inside the column list, after where the definition starts.
  return edited.slice(found.open.start);
}

/** One change to a statement's text: the characters from `start` to `end` become `text`. */
interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * The column list's opening parenthesis and `column`'s definition in it, or undefined where the
 * statement has no column list or does not define the column exactly once. A table constraint is
 * not a column, whatever its first word.
 */
function columnItem(
  words: readonly Token[],
  column: string
): { open: Token; item: Token[] } | undefined {
  const open = columnListStart(words);
  if (open === undefined) return undefined;
  const items = columnListItems(words, open);
  if (items === undefined) return undefined;
  const matches = items.filter(item => {
    const first = item[0];
    if (first === undefined) return false;
    if (
      first.kind === "word" &&
      TABLE_CONSTRAINT_START.has(first.text.toUpperCase())
    ) {
      return false;
    }
    return identifierOf(first).toLowerCase() === column.toLowerCase();
  });
  return matches.length === 1 ? { open, item: matches[0] } : undefined;
}

/**
 * The edit that declares the new type: replacing the type as written, or adding one after the
 * name where none is written. None where the type written is already the new one, case and
 * spacing aside, so a nullability change leaves it as written.
 */
function typeEdits(
  createSql: string,
  name: Token,
  typeTokens: readonly Token[],
  type: string
): TextEdit[] {
  const first = typeTokens[0];
  const last = typeTokens.at(-1);
  const written = createSql
    .slice(first?.start ?? 0, last?.end ?? 0)
    .replace(/\s+/g, "")
    .toLowerCase();
  if (written === type.replace(/\s+/g, "").toLowerCase()) return [];
  return [
    first !== undefined && last !== undefined
      ? { start: first.start, end: last.end, text: type.trim() }
      : { start: name.end, end: name.end, text: ` ${type.trim()}` },
  ];
}

/**
 * The edits that give the column the wanted nullability: removing each of its NOT NULL
 * constraints, with the space before it, to make it nullable; appending ` NOT NULL` where it has
 * none, to make it required.
 */
function nullabilityEdits(
  tokens: readonly Token[],
  item: readonly Token[],
  constraints: readonly Token[],
  nullable: boolean
): TextEdit[] {
  const notNulls = notNullSpans(constraints);
  if (!nullable) {
    const last = item.at(-1);
    return notNulls.length > 0 || last === undefined
      ? []
      : [{ start: last.end, end: last.end, text: " NOT NULL" }];
  }
  return notNulls.map(span => {
    // The space before the clause goes with it; a comment before it stays.
    const before = tokens[tokens.indexOf(span.first) - 1];
    const start = before?.kind === "space" ? before.start : span.first.start;
    return { start, end: span.last.end, text: "" };
  });
}

/**
 * The NOT NULL constraints among a column's constraints, from `CONSTRAINT name` where one names it
 * to the end of its `ON CONFLICT` clause where it has one. Only at the column's own level:
 * `NOT DEFERRABLE` and anything in parentheses are other clauses.
 */
function notNullSpans(
  tokens: readonly Token[]
): { first: Token; last: Token }[] {
  const spans: { first: Token; last: Token }[] = [];
  let depth = 0;
  for (let k = 0; k < tokens.length; k += 1) {
    if (isPunct(tokens[k], "(")) depth += 1;
    if (isPunct(tokens[k], ")")) depth -= 1;
    const span = depth === 0 ? notNullSpanAt(tokens, k) : undefined;
    if (span !== undefined) spans.push(span);
  }
  return spans;
}

/**
 * The NOT NULL constraint whose NOT is at `k`, from its `CONSTRAINT name` to its `ON CONFLICT`
 * clause where it has them, or undefined where no NOT NULL starts there.
 */
function notNullSpanAt(
  tokens: readonly Token[],
  k: number
): { first: Token; last: Token } | undefined {
  if (!isWord(tokens[k], "NOT") || !isWord(tokens[k + 1], "NULL")) {
    return undefined;
  }
  const named = k >= 2 && isWord(tokens[k - 2], "CONSTRAINT");
  const conflict =
    isWord(tokens[k + 2], "ON") && isWord(tokens[k + 3], "CONFLICT");
  const last = tokens[conflict ? k + 4 : k + 1];
  return last === undefined
    ? undefined
    : { first: named ? tokens[k - 2] : tokens[k], last };
}

/** The index of the first token at the top level that `test` accepts, or the length. */
function firstAtDepthZero(
  tokens: readonly Token[],
  test: (token: Token) => boolean
): number {
  let depth = 0;
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (depth === 0 && test(token)) return k;
    if (isPunct(token, "(")) depth += 1;
    if (isPunct(token, ")")) depth -= 1;
  }
  return tokens.length;
}

/**
 * The opening parenthesis of the column list: `CREATE [TEMP] TABLE [IF NOT EXISTS] [schema.]name (`.
 */
function columnListStart(words: readonly Token[]): Token | undefined {
  let k = 0;
  if (!isWord(words[k], "CREATE")) return undefined;
  k += 1;
  if (isWord(words[k], "TEMP") || isWord(words[k], "TEMPORARY")) k += 1;
  if (!isWord(words[k], "TABLE")) return undefined;
  k += 1;
  if (isWord(words[k], "IF")) k += 3;
  k += 1;
  if (isPunct(words[k], ".")) k += 2;
  return isPunct(words[k], "(") ? words[k] : undefined;
}

/** The column list's items, each its tokens without the commas between them. */
function columnListItems(
  words: readonly Token[],
  open: Token
): Token[][] | undefined {
  const items: Token[][] = [[]];
  let depth = 0;
  for (let k = words.indexOf(open) + 1; k < words.length; k += 1) {
    const token = words[k];
    if (isPunct(token, "(")) depth += 1;
    if (isPunct(token, ")")) {
      if (depth === 0) return items;
      depth -= 1;
    }
    if (depth === 0 && isPunct(token, ",")) items.push([]);
    else items.at(-1)?.push(token);
  }
  // No closing parenthesis.
  return undefined;
}

/**
 * The statement's tokens, with where each stands in it, or undefined where a string or quoted name
 * is never closed. Where the strings, quoted names and comments lie is read by the scanner every
 * other reader of SQL here goes through (`migrate/sql-scan`), by SQLite's rules; only the code
 * between them is split here, into space, words and single punctuation characters. A comment
 * that runs to the end of the text is a comment.
 */
function tokenize(text: string): Token[] | undefined {
  const tokens: Token[] = [];
  for (const segment of scanSql(text, "sqlite")) {
    const { start, end } = segment;
    if (segment.kind === "code") {
      tokens.push(...codeTokens(text, start, end));
    } else if (segment.kind === "string" || segment.kind === "quoted-name") {
      if (segment.unterminated) return undefined;
      tokens.push({
        kind: segment.kind === "string" ? "string" : "quoted",
        text: text.slice(start, end),
        start,
        end,
        content: segment.content,
      });
    } else {
      // A comment; SQLite has no dollar-quoted body, which the scan reads on PostgreSQL only.
      tokens.push({
        kind: "comment",
        text: text.slice(start, end),
        start,
        end,
      });
    }
  }
  return tokens;
}

/** A character that continues an unquoted word, as the scanner reads one. */
const WORD_CHARACTER = /[\w$]|[^\p{ASCII}]/u;

/** The tokens of a stretch of code with no quotes or comments in it, from `start` to `end`. */
function codeTokens(text: string, start: number, end: number): Token[] {
  const tokens: Token[] = [];
  let i = start;
  const push = (kind: Token["kind"], to: number): void => {
    tokens.push({ kind, text: text.slice(i, to), start: i, end: to });
    i = to;
  };
  while (i < end) {
    let to = i + 1;
    if (/\s/.test(text[i])) {
      while (to < end && /\s/.test(text[to])) to += 1;
      push("space", to);
    } else if (WORD_CHARACTER.test(text[i])) {
      while (to < end && WORD_CHARACTER.test(text[to])) to += 1;
      push("word", to);
    } else {
      push("punct", to);
    }
  }
  return tokens;
}

/** The tokens SQLite reads: every one but whitespace and comments. */
function significant(tokens: readonly Token[]): Token[] {
  return tokens.filter(
    token => token.kind !== "space" && token.kind !== "comment"
  );
}

/** The name a token spells: a word as written, a quoted name or string by its content. */
function identifierOf(token: Token): string {
  if (token.kind === "word") return token.text;
  return token.content ?? "";
}

const isWord = (token: Token | undefined, word: string): boolean =>
  token?.kind === "word" && token.text.toUpperCase() === word;

const isPunct = (token: Token | undefined, punct: string): boolean =>
  token?.kind === "punct" && token.text === punct;
