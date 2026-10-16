/**
 * Case-insensitive, literal substring matching: the one rule for "does this text contain that,
 * ignoring case" on every dialect.
 *
 * The where builder's `ICONTAINS` compiles through it, and so does any caller that builds its own
 * SQL against a column, such as a collection's search, so the rule cannot be spelled two ways.
 *
 * @module text-match
 */
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * Wraps a value in `%…%` for a substring match, escaping the LIKE metacharacters inside it so
 * the value matches literally.
 *
 * `!` is the escape character rather than the more usual backslash, and it has to be, because
 * this builder emits one statement for every dialect. SQLite gives LIKE no default escape
 * character at all, so a backslash there is just a backslash; declaring `ESCAPE '\'` instead
 * runs into MySQL, where the backslash also escapes inside the string literal and the clause
 * would have to be spelled differently per dialect. `ESCAPE '!'` parses identically on
 * PostgreSQL, MySQL and SQLite, and needs no per-dialect branch to stay correct.
 *
 * The escape character is escaped FIRST by including it in the character class, so a literal
 * `!` in the value cannot be produced by escaping something else afterwards.
 */
export function containsPattern(value: string): string {
  return `%${value.replace(/[!%_]/g, character => `!${character}`)}%`;
}

/**
 * `column` contains `value`, without regard to case, on PostgreSQL, MySQL and SQLite, even where
 * the column's collation is case-sensitive: both sides lower-cased, `value` matched literally
 * (its `%` and `_` are characters to find, not wildcards).
 *
 * Which letters fold is the database's own `lower()` under the column's collation: MySQL by its
 * collation's Unicode version, PostgreSQL's non-ASCII letters too under a linguistic collation,
 * and ASCII letters only on SQLite and under PostgreSQL's `C` or `POSIX`.
 *
 * @experimental
 * @param column - The column, or any SQL expression yielding text
 * @param value - The text to find, as the person typed it
 * @returns The condition
 */
export function caseInsensitiveContains(
  column: SQLWrapper,
  value: string
): SQL {
  return sql`lower(${column}) like lower(${containsPattern(value)}) escape '!'`;
}
