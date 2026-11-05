/**
 * The SQL functions a SQLite connection needs before Nextly's statements run on it.
 *
 * @module sql-functions
 */
import { registerSqliteFoldCase } from "@nextlyhq/adapter-drizzle/text-match";
import type Database from "better-sqlite3";

/**
 * Register the SQL functions Nextly's statements call on SQLite, on `db`: the Unicode case fold
 * (`nextly_fold_case`), since SQLite's own `lower()` folds ASCII letters only.
 *
 * Every connection the adapter opens is handed here as it opens, before anything runs on it, so
 * no statement can reach a connection without the function.
 */
export function registerSqliteFunctions(db: Database.Database): void {
  registerSqliteFoldCase(db);
}
