/**
 * The tables one migration statement changes, read through the shared
 * statement cursor (`statement-cursor.ts`).
 *
 * Only the forms below are read. Anything else, including a schema-qualified
 * name and an index drop that names no table, is unreadable and answered
 * `undefined` rather than guessed: a caller deciding whether a file stays inside
 * one entity's tables must count an unreadable statement as leaving them.
 *
 * @module domains/schema/migrate/statement-targets
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  cursorOf,
  StatementCursor,
  type StatementToken,
} from "./statement-cursor";

/** One or more names separated by commas, or undefined if any is not a name. */
function nameList(cursor: StatementCursor): string[] | undefined {
  const names: string[] = [];
  do {
    const name = cursor.name();
    if (name === undefined) return undefined;
    names.push(name);
  } while (cursor.accept(","));
  return names;
}

/** The one table a statement names next, as a list, or undefined. */
function oneTable(cursor: StatementCursor): string[] | undefined {
  const name = cursor.name();
  return name === undefined ? undefined : [name];
}

/**
 * The tables `statement` changes, lower-cased, or `undefined` when it is not a
 * form read here: CREATE/ALTER/DROP TABLE, CREATE [UNIQUE] INDEX … ON, MySQL's
 * DROP INDEX … ON, INSERT INTO, UPDATE and DELETE FROM.
 */
export function tablesChangedIn(
  statement: string,
  dialect: SupportedDialect
): string[] | undefined {
  const cursor = cursorOf(statement, dialect);
  if (cursor.accept("CREATE")) {
    cursor.accept("TEMPORARY");
    if (cursor.accept("TABLE")) {
      cursor.acceptCondition();
      return oneTable(cursor);
    }
    cursor.accept("UNIQUE");
    if (!cursor.accept("INDEX")) return undefined;
    cursor.acceptCondition();
    if (cursor.name() === undefined || !cursor.accept("ON")) return undefined;
    return oneTable(cursor);
  }
  if (cursor.accept("ALTER", "TABLE")) {
    cursor.acceptCondition();
    cursor.accept("ONLY");
    return oneTable(cursor);
  }
  if (cursor.accept("DROP", "TABLE")) {
    cursor.acceptCondition();
    return nameList(cursor);
  }
  if (cursor.accept("DROP", "INDEX")) {
    // Only MySQL's form names the table; elsewhere the index alone is named.
    cursor.acceptCondition();
    if (cursor.name() === undefined || !cursor.accept("ON")) return undefined;
    return oneTable(cursor);
  }
  if (cursor.accept("INSERT", "INTO")) return oneTable(cursor);
  if (cursor.accept("UPDATE")) return oneTable(cursor);
  if (cursor.accept("DELETE", "FROM")) return oneTable(cursor);
  return undefined;
}

/**
 * The indexes a DROP INDEX that names no table drops (PostgreSQL's and
 * SQLite's form), lower-cased, or `undefined` for any other statement. Which
 * table an index is on is the caller's to trace from its name. CASCADE is
 * refused: it drops whatever depends on the index too.
 */
export function indexesDroppedBy(
  statement: string,
  dialect: SupportedDialect
): string[] | undefined {
  const cursor = cursorOf(statement, dialect);
  if (!cursor.accept("DROP", "INDEX")) return undefined;
  cursor.accept("CONCURRENTLY");
  cursor.acceptCondition();
  const names = nameList(cursor);
  cursor.accept("RESTRICT");
  return names !== undefined && cursor.done() ? names : undefined;
}

/**
 * The tables `statement` drops when it is a DROP TABLE, lower-cased, or
 * `undefined` for any other statement: what a drop-only file is held to.
 */
export function tablesDroppedBy(
  statement: string,
  dialect: SupportedDialect
): string[] | undefined {
  const cursor = cursorOf(statement, dialect);
  if (!cursor.accept("DROP", "TABLE")) return undefined;
  cursor.acceptCondition();
  return nameList(cursor);
}

/** A registry row a statement writes: the registry table and the row's slug. */
export interface RegistryRowWrite {
  table: string;
  slug: string;
}

/** A string token's exact text, or undefined for any other token. */
function stringText(tokens: readonly StatementToken[]): string | undefined {
  if (tokens.length !== 1) return undefined;
  const [token] = tokens;
  return typeof token !== "string" && token.kind === "string"
    ? token.text
    : undefined;
}

/**
 * The column an assignment sets, read past its `=`, or undefined when it does
 * not open with one; never `slug` or `id`, which would move the row into
 * another entity's.
 */
function assignedColumn(cursor: StatementCursor): string | undefined {
  const column = cursor.name();
  if (column === undefined || column === "slug" || column === "id") {
    return undefined;
  }
  return cursor.accept("=") ? column : undefined;
}

/**
 * Whether every assignment of an upsert's update sets a column to the value
 * the INSERT gave it, and does nothing else: `c = EXCLUDED.c` on PostgreSQL,
 * `c = VALUES(c)` on MySQL, as the Builder writes it. Anything after the last
 * one, including a further statement left without its `;`, is refused.
 */
function setsInsertedValues(assignments: StatementToken[][]): boolean {
  return assignments.every(assignment => {
    const cursor = new StatementCursor(assignment);
    const column = assignedColumn(cursor);
    if (column === undefined) return false;
    if (cursor.isWord(`EXCLUDED.${column.toUpperCase()}`)) {
      cursor.at += 1;
    } else if (cursor.accept("EXCLUDED.")) {
      if (cursor.name() !== column) return false;
    } else {
      if (!cursor.accept("VALUES", "(")) return false;
      if (cursor.name() !== column || !cursor.accept(")")) return false;
    }
    return cursor.done();
  });
}

/**
 * Whether every assignment of an UPDATE sets a column to one string or to
 * NULL, and does nothing else.
 */
function setsPlainValues(assignments: StatementToken[][]): boolean {
  return assignments.every(assignment => {
    const cursor = new StatementCursor(assignment);
    if (assignedColumn(cursor) === undefined) return false;
    const value = cursor.rest();
    if (value.length !== 1) return false;
    const [token] = value;
    return (
      token === "NULL" || (typeof token !== "string" && token.kind === "string")
    );
  });
}

/**
 * The registry row `statement` writes, when it is one of the two shapes a
 * row keyed on its slug is written in, or undefined:
 *
 * - `INSERT INTO t (columns) VALUES (values)`, one row whose `slug` value is a
 *   string read exactly, with nothing after it, or PostgreSQL's
 *   `ON CONFLICT (slug) DO NOTHING` / `DO UPDATE SET …`, or MySQL's
 *   `ON DUPLICATE KEY UPDATE …`. MySQL's form fires on any unique key, which
 *   writes this slug's row only because a registry row's other unique keys,
 *   its id and table name, are derived from its slug.
 * - `UPDATE t SET … WHERE slug = '…'`, with nothing else in the WHERE.
 *
 * No assignment may set `slug` or `id`, which would rename the row into
 * another entity's, and each is read whole, so text after the last one (a
 * further statement left without its `;`, which the runner would send with
 * it) is refused. Which table is the registry is the caller's to judge.
 */
export function registryRowWrittenBy(
  statement: string,
  dialect: SupportedDialect
): RegistryRowWrite | undefined {
  const cursor = cursorOf(statement, dialect);
  if (cursor.accept("INSERT", "INTO")) return insertedRow(cursor);
  if (cursor.accept("UPDATE")) return updatedRow(cursor);
  return undefined;
}

/** An INSERT's one row, read after `INSERT INTO`. */
function insertedRow(cursor: StatementCursor): RegistryRowWrite | undefined {
  const table = cursor.name();
  if (table === undefined || !cursor.accept("(")) return undefined;
  const columns = nameList(cursor);
  if (columns === undefined || !cursor.accept(")")) return undefined;
  if (!cursor.accept("VALUES", "(")) return undefined;
  const values = parenthesised(cursor);
  if (values === undefined || values.length !== columns.length) {
    return undefined;
  }
  const slug = stringText(values[columns.indexOf("slug")] ?? []);
  if (slug === undefined || !upsertKeepsSlug(cursor)) return undefined;
  return { table, slug };
}

/**
 * The comma-separated items up to the `)` that closes a list already opened,
 * consumed with it, or undefined when the list never closes.
 */
function parenthesised(
  cursor: StatementCursor
): StatementToken[][] | undefined {
  const items: StatementToken[][] = [[]];
  let depth = 0;
  for (;;) {
    const token = cursor.peek();
    if (token === undefined) return undefined;
    cursor.at += 1;
    if (token === ")" && depth === 0) return items;
    if (token === "(") depth += 1;
    if (token === ")") depth -= 1;
    if (token === "," && depth === 0) items.push([]);
    else items[items.length - 1].push(token);
  }
  return undefined;
}

/** Whether what follows an INSERT's row is nothing, or an upsert on its slug. */
function upsertKeepsSlug(cursor: StatementCursor): boolean {
  if (cursor.done()) return true;
  if (cursor.accept("ON", "DUPLICATE", "KEY", "UPDATE")) {
    return setsInsertedValues(cursor.clauses());
  }
  if (!cursor.accept("ON", "CONFLICT", "(")) return false;
  if (cursor.name() !== "slug" || !cursor.accept(")", "DO")) return false;
  if (cursor.accept("NOTHING")) return cursor.done();
  return cursor.accept("UPDATE", "SET") && setsInsertedValues(cursor.clauses());
}

/** An UPDATE keyed on one slug, read after `UPDATE`. */
function updatedRow(cursor: StatementCursor): RegistryRowWrite | undefined {
  const table = cursor.name();
  if (table === undefined || !cursor.accept("SET")) return undefined;
  const rest = cursor.rest();
  const where = rest.lastIndexOf("WHERE");
  if (where === -1) return undefined;
  const key = new StatementCursor(rest.slice(where + 1));
  if (key.name() !== "slug" || !key.accept("=")) return undefined;
  const slug = stringText(key.rest());
  const assignments = new StatementCursor(rest.slice(0, where)).clauses();
  if (slug === undefined || !setsPlainValues(assignments)) return undefined;
  return { table, slug };
}
