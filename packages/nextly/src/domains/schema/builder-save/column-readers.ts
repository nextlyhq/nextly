/**
 * Whether an expression the database states as text reads a column: a CHECK's, or a generated
 * column's, which SQLite states only in the table's own statement. Read through the tokenizer every
 * reader of a statement's shape shares (`statementTokens`), so a quoted name, a string, or a comment
 * hides nothing from it and shows nothing in it. Where a reading is in doubt it answers that the
 * column is read: what is lost with a column has no other place it is said.
 *
 * @module domains/schema/builder-save/column-readers
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { statementTokens } from "../migrate/split-sql";
import type { StatementToken } from "../migrate/statement-cursor";

/** Whether `expression` names `column`, its strings and comments aside. */
export function namesColumn(
  expression: string,
  column: string,
  dialect: SupportedDialect
): boolean {
  return statementTokens(expression, dialect).some(token =>
    isColumn(token, column)
  );
}

/**
 * What in a SQLite table's stored `statement` reads `column`: a CHECK constraint, its column's own or
 * the table's, named or not, and a generated column.
 */
export function sqliteReadersIn(statement: string, column: string): string[] {
  const tokens = statementTokens(statement, "sqlite");
  return [
    ...(readsAfter(tokens, "CHECK", column)
      ? [`a CHECK that reads ${column}`]
      : []),
    ...(readsAfter(tokens, "AS", column)
      ? [`a generated column that reads ${column}`]
      : []),
  ];
}

/** Whether any parenthesized expression after `keyword` names `column`, or never closes. */
function readsAfter(
  tokens: readonly StatementToken[],
  keyword: string,
  column: string
): boolean {
  return tokens.some((token, at) => {
    if (token !== keyword || tokens[at + 1] !== "(") return false;
    const expression = expressionFrom(tokens, at + 2);
    return (
      expression === undefined ||
      expression.some(inside => isColumn(inside, column))
    );
  });
}

/** The tokens from `at` to the parenthesis that closes the one before it; undefined where none does. */
function expressionFrom(
  tokens: readonly StatementToken[],
  at: number
): readonly StatementToken[] | undefined {
  let depth = 1;
  for (let end = at; end < tokens.length; end += 1) {
    if (tokens[end] === "(") depth += 1;
    if (tokens[end] === ")") depth -= 1;
    if (depth === 0) return tokens.slice(at, end);
  }
  return undefined;
}

/**
 * Whether a token is `column`'s name, quoted or not, alone or qualified by its table (`t.v`), in any
 * case. A quoted name cut off before its closing quote names nothing that can be read, so it may be.
 */
function isColumn(token: StatementToken, column: string): boolean {
  const name = column.toUpperCase();
  if (typeof token === "string") return token.split(".").includes(name);
  if (token.kind !== "name") return false;
  return token.name === undefined || token.name === name;
}
