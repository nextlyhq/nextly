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

/**
 * A single-quoted SQL string literal with embedded quotes doubled, which is
 * the escape every dialect this project targets accepts.
 */
export function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
