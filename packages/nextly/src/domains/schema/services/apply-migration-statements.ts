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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import type { DatabaseInstance } from "../../../types/database-operations";
import {
  isIdempotencyError,
  splitStatements,
} from "../pipeline/sql-statement-utils";
import { isRenameStatement } from "../rename-target";

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
  migrationSQL: string,
  busyTable?: BusyTableWait
): Promise<void> {
  if (busyTable !== undefined) {
    // Each statement commits as it runs, as below, waiting for a busy table in short tries; one
    // the schema already satisfies is passed over as below, never a rename.
    const statements = splitStatements([migrationSQL]);
    if (statements.length === 0) return;
    await runInTries(
      busyTable,
      statements,
      { source: "the Schema Builder change", transaction: false },
      (error, statement) =>
        !isRenameStatement(statement) && isIdempotencyError(error)
    );
    return;
  }
  for (const statement of splitStatements([migrationSQL])) {
    try {
      await adapter.executeQuery(statement);
    } catch (error) {
      // A rename's refusal is a rename that could not be made, never one already applied.
      if (isRenameStatement(statement) || !isIdempotencyError(error)) {
        throw error;
      }
    }
  }
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
  /**
   * On SQLite, the columns of `tableName` to make NOT NULL (true) or nullable (false) once the
   * statements have run, which SQLite does by rebuilding the table (`rebuildSqliteNullability`).
   * The statements and the rebuild then run as one unit through `executeTransaction`.
   */
  sqliteNullability?: SqliteNullability;
  /**
   * Where given, the migration waits for a table another session is using as `nextly migrate`
   * waits, in short tries (`runInTries`), and the statements run through the runner a migration
   * file runs through: on SQLite with foreign keys off for the change and its dangling references
   * checked before it commits. Without it, the statements run once, as before.
   */
  busyTable?: BusyTableWait;
}): Promise<void> {
  // The one splitting rule: a separator is a line of its own, so its text inside a quoted value
  // stays part of the statement.
  const statements = splitStatements([args.migrationSQL]);
  const rebuild =
    args.dialect === "sqlite" && args.sqliteNullability?.required.size
      ? args.sqliteNullability
      : undefined;
  if (statements.length === 0 && rebuild === undefined) return;
  const progress = { ran: 0 };
  try {
    if (args.busyTable !== undefined) {
      await runWholeInTries(
        args,
        args.busyTable,
        statements,
        rebuild,
        progress
      );
    } else {
      await (rebuild === undefined
        ? runStatements(args, statements, progress)
        : runRebuilding(rebuild, statements, progress));
    }
  } catch (error: unknown) {
    // Tries that ran out say so themselves: the table, what holds it, and that nothing changed.
    if (NextlyError.is(error) && error.code === "NEXTLY_TABLE_BUSY")
      throw error;
    // A refusal of the rebuild's own (a table it can't reproduce, a reference left dangling) says
    // why, as it is.
    if (rebuild !== undefined && error instanceof NextlyError) throw error;
    throw migrationRefused(
      error,
      progress.ran,
      statements.length,
      args.dialect !== "mysql",
      args.entity
    );
  }
}

/** How a Builder save's statements wait for a busy table: the adapter they run on, and where each try's notice goes. */
export interface BusyTableWait {
  adapter: DrizzleAdapter;
  notify: (line: string) => void;
}

/**
 * Runs `statements` one at a time, each committing as it runs, as one change that waits for a busy
 * table in short tries, so a stop reports what of it stayed. Strict by default, as a plan that must
 * not pass over a re-run is (a translations table's change): any refusal ends it. `source` names
 * the change in the report.
 */
export async function applyStatementsInTries(
  wait: BusyTableWait,
  statements: readonly string[],
  source: string,
  /** A refusal the caller takes as already applied; none by default, which is strict. */
  passOver?: (error: unknown, statement: string) => boolean
): Promise<void> {
  if (statements.length === 0) return;
  await runInTries(wait, statements, { source, transaction: false }, passOver);
}

/**
 * Runs `statements` as one unit in tries for a busy table (`runUnitInTries`), within the bounds the
 * environment sets (`NEXTLY_LOCK_TIMEOUT`, `NEXTLY_LOCK_TIMEOUT_TOTAL`); a bound out of range
 * refuses the change before anything runs. `after` runs once every statement has, inside the
 * unit's transaction where it has one.
 */
async function runInTries(
  wait: BusyTableWait,
  statements: readonly string[],
  unit: { source: string; transaction: boolean },
  passOver?: (error: unknown, statement: string) => boolean,
  after: (db: unknown) => Promise<void> = async () => {},
  appliedBefore: () => readonly string[] = () => []
): Promise<void> {
  // Loaded here, as the rebuild is: a save that changes no table loads neither.
  const [{ busyTableBounds }, { runUnitInTries }] = await Promise.all([
    import("../busy-table/bounds"),
    import("../busy-table/run-unit"),
  ]);
  await runUnitInTries(wait.adapter, statements, unit, after, {
    bounds: busyTableBounds({ env: process.env }),
    notify: wait.notify,
    appliedBefore,
    ...(passOver === undefined ? {} : { passOver }),
  });
}

/**
 * `applyMigrationWhole` in tries for a busy table. On PostgreSQL and SQLite the statements, and a
 * SQLite rebuild after them, are one unit in one transaction. On MySQL, which commits each schema
 * statement as it runs, each statement is a unit of its own, so the refusal can still say how many
 * were applied; a statement the table already satisfies is passed over where `tolerateApplied`
 * asks it.
 */
async function runWholeInTries(
  args: {
    dialect: SupportedDialect | undefined;
    entity: string;
    tolerateApplied?: boolean;
  },
  wait: BusyTableWait,
  statements: readonly string[],
  rebuild: SqliteNullability | undefined,
  progress: { ran: number }
): Promise<void> {
  const source = `the ${args.entity}'s schema change`;
  if (args.dialect !== "mysql") {
    const after =
      rebuild === undefined
        ? undefined
        : async (db: unknown) => {
            const { rebuildSqliteNullability } = await import(
              "./sqlite-nullability-rebuild"
            );
            // Inside the unit's transaction, on its one SQLite connection.
            await rebuildSqliteNullability(
              {
                db,
                execute: async statement => {
                  await wait.adapter.executeQuery(statement);
                },
                restoreSession: () => Promise.resolve(),
                session: () => Promise.resolve(undefined),
              },
              rebuild.tableName,
              rebuild.required
            );
          };
    await runInTries(
      wait,
      statements,
      { source, transaction: true },
      undefined,
      after
    );
    progress.ran = statements.length;
    return;
  }
  const tolerate =
    args.tolerateApplied === true
      ? (error: unknown, statement: string) =>
          !isRenameStatement(statement) && alreadyApplied(error)
      : undefined;
  for (const [index, statement] of statements.entries()) {
    await runInTries(
      wait,
      [statement],
      {
        source: `${source}, statement ${String(index + 1)}`,
        transaction: true,
      },
      tolerate,
      undefined,
      () => (index === 0 ? [] : [`${source}, statements 1 to ${String(index)}`])
    );
    progress.ran += 1;
  }
}

/** What a SQLite migration's rebuild changes: whether each column of the table may be empty. */
export interface SqliteNullability {
  adapter: DrizzleAdapter;
  tableName: string;
  /** Column → true for NOT NULL, false for nullable. */
  required: ReadonlyMap<string, boolean>;
}

/**
 * The statements, then the table rebuilt with its columns' new nullability, in one transaction
 * with foreign keys off (`executeTransaction`), so the rebuild's drop of the table doesn't cascade
 * into the rows that reference it, and is checked for dangling references before it commits.
 */
async function runRebuilding(
  rebuild: SqliteNullability,
  statements: readonly string[],
  progress: { ran: number }
): Promise<void> {
  // Loaded here, not at the top: only a SQLite save that changes whether a column may be empty
  // rebuilds a table, and every save and boot that loads this module would otherwise load the
  // rebuild and the migration transaction too.
  const [{ executeTransaction }, { rebuildSqliteNullability }] =
    await Promise.all([
      import("../migrate/migration-transaction"),
      import("./sqlite-nullability-rebuild"),
    ]);
  await executeTransaction(rebuild.adapter, async tx => {
    for (const statement of statements) {
      await tx.execute(statement);
      progress.ran += 1;
    }
    await rebuildSqliteNullability(tx, rebuild.tableName, rebuild.required);
  });
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
        // A rename's refusal is never passed over: "the target already exists" is exactly a rename
        // that could not be made, and recording it as made would leave the values under the old
        // name while the registry names the new one.
        if (
          !tolerate ||
          isRenameStatement(statement) ||
          !alreadyApplied(error)
        ) {
          throw error;
        }
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
