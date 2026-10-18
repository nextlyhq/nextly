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

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import type { DatabaseInstance } from "../../../types/database-operations";
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
 */
export async function applyMigrationStatements(
  adapter: MigrationStatementRunner,
  migrationSQL: string
): Promise<void> {
  for (const statement of splitStatements([migrationSQL])) {
    try {
      await adapter.executeQuery(statement);
    } catch (error) {
      if (!isIdempotencyError(error)) throw error;
    }
  }
}

/**
 * A migration's statements: split on Drizzle's `--> statement-breakpoint` separator, with comment
 * lines dropped so a chunk holding only a comment is not sent.
 */
function migrationStatements(migrationSQL: string): string[] {
  return migrationSQL
    .split("--> statement-breakpoint")
    .map(statement =>
      statement
        .split("\n")
        .filter(line => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(statement => statement.length > 0);
}

/** The error a refused migration is reported with: whether anything ran, and where it stopped. */
function migrationRefused(
  error: unknown,
  ran: number,
  total: number,
  transactional: boolean,
  entity: string
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_MIGRATION_APPLY_FAILED",
    publicMessage: transactional
      ? "The database refused this schema change, so nothing was changed."
      : `The database refused statement ${ran + 1} of ${total} of this schema change. ` +
        `The ${ran} before it were applied; saving again finishes the change from the table as it is now.`,
    logMessage: `${entity} migration refused at statement ${ran + 1} of ${total}: ${
      error instanceof Error ? error.message : String(error)
    }`,
    logContext: { statement: ran + 1, of: total, transactional },
    cause: error instanceof Error ? error : undefined,
  });
}

/**
 * Run a Schema Builder save's migration whole or not at all, where the dialect allows it: one
 * transaction on PostgreSQL and SQLite. MySQL commits each schema statement as it runs, so there
 * the refusal says which statement stopped it and how many before it were applied.
 *
 * The collection save and the Single save both run through this, so the two cannot come to apply
 * a migration differently.
 *
 * @param tolerateApplied - On MySQL only, pass over a statement the table already satisfies
 *   (`alreadyApplied`), so a save repeated after one refused part-way finishes the change. A
 *   caller that plans its re-save from the live table instead leaves it off. Nothing is tolerated
 *   inside a transaction, where a refused statement ends it.
 * @throws NextlyError `NEXTLY_MIGRATION_APPLY_FAILED` when the database refuses a statement
 */
export async function applyMigrationWhole(args: {
  db: DatabaseInstance;
  dialect: SupportedDialect | undefined;
  migrationSQL: string;
  /** What the migration changes, for the log: "collection" or "single". */
  entity: string;
  tolerateApplied?: boolean;
}): Promise<void> {
  const statements = migrationStatements(args.migrationSQL);
  if (statements.length === 0) return;
  const progress = { ran: 0 };
  try {
    await runStatements(args, statements, progress);
  } catch (error: unknown) {
    throw migrationRefused(
      error,
      progress.ran,
      statements.length,
      args.dialect !== "mysql",
      args.entity
    );
  }
}

/** The statements, in one transaction where the dialect has transactional schema changes. */
async function runStatements(
  args: {
    db: DatabaseInstance;
    dialect: SupportedDialect | undefined;
    tolerateApplied?: boolean;
  },
  statements: readonly string[],
  progress: { ran: number }
): Promise<void> {
  const dbInstance = args.db as unknown as DrizzleExecutor;
  const client = dbInstance.$client;
  if (
    typeof client?.exec === "function" &&
    typeof client?.transaction === "function"
  ) {
    // SQLite (better-sqlite3): one synchronous transaction around every statement.
    const exec = client.exec.bind(client);
    client.transaction(() => {
      for (const statement of statements) {
        exec(statement);
        progress.ran += 1;
      }
    })();
    return;
  }
  if (typeof dbInstance.execute !== "function") {
    throw NextlyError.internal({
      logContext: {
        reason:
          "the database instance supports neither execute nor $client.exec",
      },
    });
  }
  const tolerate = args.tolerateApplied === true && args.dialect === "mysql";
  const runAll = async (db: DrizzleExecutor) => {
    for (const statement of statements) {
      try {
        await db.execute(sql.raw(statement));
      } catch (error) {
        if (!tolerate || !alreadyApplied(error)) throw error;
      }
      progress.ran += 1;
    }
  };
  // MySQL commits each schema statement as it runs; there is no whole to roll back.
  await (args.dialect === "postgresql"
    ? dbInstance.transaction(runAll)
    : runAll(dbInstance));
}

/**
 * Whether a refused statement is one an earlier run of the same migration already applied: a table
 * or column already there, or a column already gone. A duplicate INDEX name is not among them,
 * because the name alone cannot tell the index an earlier run created from another one holding the
 * name, and passing over that would record a uniqueness the database does not enforce.
 */
function alreadyApplied(error: unknown): boolean {
  const message = [
    error instanceof Error ? error.message : String(error),
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "",
  ].join(" ");
  return isIdempotencyError(error) && !/duplicate key name/i.test(message);
}

/** The parts of a Drizzle database the runner calls, as each driver provides them. */
interface DrizzleExecutor {
  $client?: {
    exec?: (statement: string) => unknown;
    transaction?: (run: () => void) => () => void;
  };
  execute(query: ReturnType<typeof sql.raw>): Promise<unknown>;
  transaction(run: (tx: DrizzleExecutor) => Promise<void>): Promise<void>;
}
