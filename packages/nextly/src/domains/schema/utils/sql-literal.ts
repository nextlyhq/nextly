/**
 * Quoting a value into a generated SQL literal.
 *
 * DDL is assembled as text before it reaches the driver, so a default value
 * carrying an apostrophe — `O'Reilly` in a block's heading, say — would close
 * the quote early and produce a statement that fails to parse. Escaping is
 * therefore part of emitting the literal, not something a caller remembers.
 *
 * This is for GENERATED DDL only. Query values go through Drizzle, which
 * parameterizes them; nothing here should be used to build a query.
 *
 * @module domains/schema/utils/sql-literal
 */

import type { SupportedDialect } from "../../../types/database";

/**
 * A single-quoted SQL string literal, escaped for the target dialect.
 *
 * Every dialect accepts a doubled apostrophe. Backslashes are where they
 * diverge: PostgreSQL and SQLite store one verbatim, while MySQL reads it as
 * an escape introducer. That difference bites JSON defaults specifically,
 * because JSON encodes a newline as the two characters `\` and `n` — MySQL
 * would turn those back into a real newline, and a literal newline inside a
 * JSON string is not valid JSON, so the stored default would no longer parse.
 * Doubling the backslash for MySQL keeps the text the parser sees identical
 * to the text every other dialect stores.
 *
 * The MySQL branch assumes the server's default SQL mode. Under
 * `NO_BACKSLASH_ESCAPES` a backslash is already an ordinary character, and
 * doubling it there would store two.
 */
export function quoteSqlLiteral(
  value: string,
  dialect: SupportedDialect
): string {
  const escaped = dialect === "mysql" ? value.replace(/\\/g, "\\\\") : value;
  return `'${escaped.replace(/'/g, "''")}'`;
}
