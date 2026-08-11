/**
 * Run a generated migration against a live adapter, one statement at a time.
 *
 * ## Why this is shared rather than written where it is needed
 *
 * Every Schema-Builder path that changes a table does the same two things: split the generated SQL
 * into statements, and run them. Both dispatchers had their own copy of that, and a private copy of
 * a splitting rule is exactly what `splitStatements` exists to prevent — its header records two
 * earlier copies drifting and causing a real bug.
 *
 * ## Re-running has to be safe, and on MySQL it was not
 *
 * A create or an apply that stops half way leaves schema behind. Finishing it means running the
 * same statements again over what is already there, so "already exists" has to be tolerated:
 *
 * - PostgreSQL and SQLite emit `IF NOT EXISTS` for tables AND indexes, so they tolerate it
 *   themselves.
 * - **MySQL has no such form for `CREATE INDEX`.** A second run died on the index and the caller
 *   recorded a schema that was in fact correct as a failed migration, with no way forward — the
 *   retry failed the same way every time.
 *
 * The boot-time and pipeline paths (`fresh-push`, `DrizzleStatementExecutor`) reached this
 * conclusion long ago and already tolerate it. Only the Builder's own request paths were missed.
 *
 * 🔴 The tolerance is deliberately narrow. `isIdempotencyError` is anchored to the DDL wordings —
 * "already exists", duplicate column, duplicate KEY NAME — and refuses to match MySQL's
 * `Duplicate entry ... for key` (error 1062), which is a runtime DATA conflict. Swallowing that
 * would let a rebuild's copy fail silently and the following drop destroy the rows that did not
 * copy.
 *
 * @module domains/schema/services/apply-migration-statements
 */

import {
  isIdempotencyError,
  splitStatements,
} from "../pipeline/sql-statement-utils";

/**
 * The adapter surface this needs.
 *
 * Declared structurally rather than importing `DrizzleAdapter`, so the helper states its one
 * requirement and any caller holding something narrower can still use it.
 */
export interface MigrationStatementRunner {
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Apply a generated migration, tolerating statements the schema already satisfies.
 *
 * Throws on anything else, so a caller can still record the change as failed.
 *
 * @returns how many statements were dispatched. A caller deciding what it may claim about the
 * schema afterwards needs to know whether anything actually ran, and the SQL string cannot answer
 * that: a diff with no operations still renders a header comment, so a non-empty string is not a
 * non-empty migration. Counted here because this is where the splitting rule lives, and any caller
 * re-deriving it from the text would be a second implementation of that rule.
 */
export async function applyMigrationStatements(
  adapter: MigrationStatementRunner,
  migrationSQL: string
): Promise<number> {
  let dispatched = 0;
  for (const statement of splitStatements([migrationSQL])) {
    dispatched += 1;
    try {
      await adapter.executeQuery(statement);
    } catch (error) {
      if (!isIdempotencyError(error)) throw error;
    }
  }
  return dispatched;
}
