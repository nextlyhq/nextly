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

import { cursorOf, type StatementCursor } from "./statement-cursor";

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
