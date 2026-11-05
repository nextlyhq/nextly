/**
 * The SQL functions a SQLite connection needs before Nextly's statements run on it.
 *
 * @module sql-functions
 */
import {
  foldCase,
  SQLITE_FOLD_CASE_FUNCTION,
} from "@nextlyhq/adapter-drizzle/text-match";
import type Database from "better-sqlite3";

/**
 * Register the Unicode case fold (`nextly_fold_case`) on `db`, the function the text matches that
 * ignore case call on SQLite, since SQLite's own `lower()` folds ASCII letters only.
 *
 * Every connection the adapter opens is handed here as it opens, before anything runs on it, so
 * no statement can reach a connection without the function. Deterministic, since the fold reads
 * nothing but its argument, which lets SQLite use it anywhere a deterministic function may stand.
 *
 * NULL stays NULL, as `lower()` keeps it. A number or a blob is folded as the text SQLite would
 * read it as, which is also what `lower()` does with one.
 */
export function registerSqliteFunctions(db: Database.Database): void {
  db.function(
    SQLITE_FOLD_CASE_FUNCTION,
    { deterministic: true },
    (text: unknown) => (text === null ? null : foldCase(textOf(text)))
  );
}

/** A SQL value as the text SQLite reads it as: a blob's bytes as UTF-8, anything else spelled. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return String(value);
}
