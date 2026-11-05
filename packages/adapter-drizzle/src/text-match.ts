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

import type { SupportedDialect } from "./types/core";

/**
 * The SQL function every SQLite connection Nextly opens carries for folding case, registered by
 * the SQLite adapter as {@link foldCase} (`better-sqlite3` runs JavaScript SQL functions
 * in-process).
 *
 * SQLite's built-in `lower()` folds ASCII letters only, so "CRÈME" lowered stays "crÈme" there
 * while PostgreSQL and MySQL give "crème". The name is Nextly's own rather than a replacement
 * for `lower()`: a connection that does not carry it, one opened by other software, refuses the
 * statement with "no such function", where an overridden `lower()` would quietly fall back to
 * ASCII on such a connection and match fewer rows than the other dialects.
 */
export const SQLITE_FOLD_CASE_FUNCTION = "nextly_fold_case";

/**
 * Text lower-cased one letter at a time by Unicode's default mapping, independent of locale: the
 * fold SQLite connections apply as {@link SQLITE_FOLD_CASE_FUNCTION}.
 *
 * Letter by letter, so each letter folds the same wherever it stands, as PostgreSQL's and
 * MySQL's `lower()` fold it: a capital sigma is "σ" even at the end of a word, where the
 * whole-string `toLowerCase()` would write "ς" and a search for the middle of a word would miss
 * it.
 *
 * The one letter whose lower case is two characters, the Turkish capital dotted I ("İ"), folds to
 * a plain "i", as `lower()` gives it on PostgreSQL (under a libc locale) and on MySQL; the
 * default mapping's "i" followed by a combining dot would keep "İstanbul" from matching
 * "istanbul" on SQLite alone. The dotless "ı" stays itself on all three, so it does not match "i".
 *
 * A final sigma ("ς") folds to "σ", so "ΟΣ" and "ος" meet: lower-casing alone leaves a typed
 * final sigma as itself while its capital folds to "σ". {@link caseFolded} applies the same
 * mapping after `lower()` on PostgreSQL and MySQL, so the three agree.
 */
export function foldCase(text: string): string {
  let folded = "";
  for (const letter of text) {
    folded += FOLD_EXCEPTIONS[letter] ?? letter.toLowerCase();
  }
  return folded;
}

/** The letters whose fold is not their default lower case, and what they fold to. */
const FOLD_EXCEPTIONS: Readonly<Record<string, string>> = {
  "\u0130": "i",
  "\u03C2": "\u03C3",
};

/**
 * `text` with its case folded, on `dialect`: the database's own `lower()` on PostgreSQL and
 * MySQL, and {@link SQLITE_FOLD_CASE_FUNCTION} on SQLite, whose `lower()` folds ASCII only.
 *
 * Which letters fold on PostgreSQL and MySQL is the database's own rule under the column's
 * collation: MySQL by its collation's Unicode version, PostgreSQL's letters outside ASCII under
 * a linguistic locale but not under `C` or `POSIX`.
 *
 * @experimental
 * @param dialect - The dialect the statement runs on
 * @param text - The column, or any SQL expression yielding text
 * @returns The folded text
 */
export function caseFolded(dialect: SupportedDialect, text: SQLWrapper): SQL {
  // `replace` exists on both, with the same arguments: a final sigma folds as {@link foldCase}
  // folds it on SQLite.
  return dialect === "sqlite"
    ? sql`${sql.identifier(SQLITE_FOLD_CASE_FUNCTION)}(${text})`
    : sql`replace(lower(${text}), ${"\u03C2"}, ${"\u03C3"})`;
}

/** The part of a SQLite connection that registers a SQL function, as `better-sqlite3` has it. */
export interface SqliteFunctionHost {
  function(
    name: string,
    options: { deterministic: boolean },
    implementation: (value: unknown) => unknown
  ): unknown;
}

/**
 * Register {@link SQLITE_FOLD_CASE_FUNCTION} on a SQLite connection: what every connection a
 * SQLite adapter opens must carry before Nextly's statements run on it, since `contains`,
 * `ICONTAINS` and `ILIKE` call it there. The official SQLite adapter registers it on each
 * connection it opens; an adapter of your own on SQLite calls this on each of its connections.
 *
 * Deterministic, since the fold reads nothing but its argument. NULL stays NULL, as `lower()`
 * keeps it; a number or a blob is folded as the text SQLite would read it as.
 *
 * @experimental
 */
export function registerSqliteFoldCase(db: SqliteFunctionHost): void {
  db.function(SQLITE_FOLD_CASE_FUNCTION, { deterministic: true }, value =>
    value === null ? null : foldCase(textOf(value))
  );
}

/** A SQL value as the text SQLite reads it as: a blob's bytes as UTF-8, anything else spelled. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return String(value);
}

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
 * the column's collation is case-sensitive: both sides folded by {@link caseFolded}, `value`
 * matched literally (its `%` and `_` are characters to find, not wildcards).
 *
 * @experimental
 * @param dialect - The dialect the statement runs on
 * @param column - The column, or any SQL expression yielding text
 * @param value - The text to find, as the person typed it
 * @returns The condition
 */
export function caseInsensitiveContains(
  dialect: SupportedDialect,
  column: SQLWrapper,
  value: string
): SQL {
  return sql`${caseFolded(dialect, column)} like ${caseFolded(dialect, sql`${containsPattern(value)}`)} escape '!'`;
}
