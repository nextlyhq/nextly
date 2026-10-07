/**
 * The one transaction every migration unit runs in — an app migration file,
 * a plugin module's UP, a DOWN — on one connection.
 *
 * @module domains/schema/migrate/migration-transaction
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import { isPluginLedgerRow } from "../events/ledger-scope";

import {
  refusingNewDanglingReferences,
  sqliteForeignKeysOn,
  withSqliteForeignKeysOff,
  type SqliteForeignKeySession,
} from "./sqlite-foreign-keys";

/**
 * What a migration's work runs through.
 *
 * `execute` runs a statement on the transaction's own connection, and `db` is
 * the Drizzle handle bound to it, for ledger writes that must commit or roll
 * back with the statements they record.
 */
export interface MigrationTransaction {
  execute(statement: string): Promise<void>;
  db: unknown;
}

/**
 * Runs `work` in one database transaction, through the adapter's own
 * transaction API.
 *
 * The adapter reserves a single connection for it — a pooled PostgreSQL or
 * MySQL client, SQLite's one connection — and issues BEGIN, the work and
 * COMMIT or ROLLBACK on it. Sending those as separate `executeQuery` calls
 * would hand each to whichever pooled connection was free: the BEGIN on one,
 * the statements on others, so nothing was atomic and the ROLLBACK undid
 * nothing.
 *
 * On SQLite the unit runs with foreign-key enforcement OFF and is checked
 * before it commits — SQLite's documented contract for changing a table's
 * shape:
 *
 * 1. `PRAGMA foreign_keys = OFF` before BEGIN (inside a transaction the
 *    pragma is silently ignored), after reading the setting in force.
 * 2. Inside the transaction, the setting is read back; if enforcement is
 *    still on — another transaction was open on the connection, so the pragma
 *    did nothing — the unit is refused before any statement runs.
 * 3. The statements run. With enforcement off, dropping a parent table in a
 *    rebuild (`__new_x` created, rows copied, `x` dropped, `__new_x` renamed
 *    to `x`) neither cascades into its children nor fails on them.
 * 4. `PRAGMA foreign_key_check`: a row it returns is a reference the unit
 *    left dangling, and the unit is rolled back and refused.
 * 5. COMMIT, then the setting read in step 1 is restored — whether the unit
 *    committed, was refused or failed.
 *
 * PostgreSQL and MySQL enforce foreign keys as the statements run, as their
 * migrations always have.
 */
export async function executeTransaction<T>(
  adapter: DrizzleAdapter,
  work: (tx: MigrationTransaction) => Promise<T>
): Promise<T> {
  if (adapter.getCapabilities().dialect !== "sqlite") {
    return adapter.transaction(ctx =>
      work({
        execute: async statement => {
          await ctx.execute(statement);
        },
        db: ctx.drizzle(),
      })
    );
  }

  // The adapter outside the transaction for the pragma switch, which
  // SQLite ignores inside one; the transaction's own connection for the
  // reads that must see the unit's state.
  const outside: SqliteForeignKeySession = {
    read: statement => adapter.executeQuery(statement),
    run: async statement => {
      await adapter.executeQuery(statement);
    },
  };
  return withSqliteForeignKeysOff(outside, () =>
    adapter.transaction(async ctx => {
      const inside = {
        read: <R>(statement: string) =>
          ctx.queryStatement<R>(sql.raw(statement)),
      };
      await assertForeignKeysOff(inside);
      return refusingNewDanglingReferences(
        inside,
        () =>
          work({
            execute: async statement => {
              await ctx.execute(statement);
            },
            db: ctx.drizzle(),
          }),
        (count, pairs) =>
          `This migration would leave ${String(count)} row(s) referencing rows that do not exist (${pairs}). It was rolled back, and nothing was applied.`
      );
    })
  );
}

/**
 * Refuses a unit before its first statement when foreign-key enforcement is
 * still on after the runner switched it off: another transaction was open on
 * SQLite's one connection, so the pragma did nothing.
 */
async function assertForeignKeysOff(
  session: Pick<SqliteForeignKeySession, "read">
): Promise<void> {
  if (!(await sqliteForeignKeysOn(session))) return;
  throw new NextlyError({
    code: "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
    publicMessage:
      "Foreign-key enforcement could not be switched off for this migration, because another transaction was open on the connection. Nothing was applied; re-run it once that transaction has finished.",
    logContext: { reason: "enforcement-still-on" },
  });
}

/** One migration unit as its runner needs it: a name, and how it runs. */
export interface MigrationUnit {
  /** The file or ledger key, as the operator reads it. */
  source: string;
  /**
   * False for a file marked `-- nextly:no-transaction` or a module with
   * `transaction: false`: its statements run outside a transaction.
   */
  transaction: boolean;
  /**
   * Which way the unit runs: its UP, the default, or a DOWN undoing it. Read
   * only by the advice a failure outside a transaction gives, because
   * recording a unit applied is the recovery for an UP alone.
   */
  direction?: "up" | "down";
}

/**
 * The line a run prints before a unit that runs outside a transaction, so
 * the operator knows which unit has no all-or-nothing guarantee before it
 * starts.
 */
export function outsideTransactionNotice(source: string): string {
  return `${source} runs outside a transaction, as it is marked to: each statement commits as it runs, and if one fails the statements before it stay applied.`;
}

/**
 * Runs one migration unit's statements the way the unit is marked to run,
 * and returns how many ran.
 *
 * In a transaction, the default: `executeTransaction`, so where the dialect
 * can undo schema changes a failure leaves none of the unit applied. `after`
 * runs inside that transaction, with its Drizzle handle, for a ledger row
 * that must commit or roll back with the statements it records.
 *
 * Outside one: each statement runs on its own through the adapter and commits
 * as it runs, which is what lets PostgreSQL's `CREATE INDEX CONCURRENTLY`
 * run at all. A statement that fails stops the unit, and nothing undoes the
 * statements before it; the error says how many of them stayed applied.
 * `after` runs once every statement has, with the adapter's own handle.
 *
 * On SQLite a unit run outside a transaction keeps the foreign-key contract
 * `executeTransaction` gives one run in a transaction, except the rollback:
 * enforcement is switched off before its first statement (and the unit
 * refused if it stayed on), so a table rebuild neither cascades into the rows
 * of tables that reference it nor fails on them; `PRAGMA foreign_key_check`
 * runs after its last statement; and the setting in force before it is
 * restored, whether the unit finished, failed or was refused. A unit that
 * left new dangling references is refused with them named, but its
 * statements stay applied, so `after` does not run and the caller records it
 * failed.
 */
export async function runMigrationStatements(
  adapter: DrizzleAdapter,
  statements: readonly string[],
  unit: MigrationUnit,
  after?: (db: unknown) => Promise<void>
): Promise<number> {
  if (unit.transaction) {
    await executeTransaction(adapter, async tx => {
      for (const statement of statements) {
        await tx.execute(statement);
      }
      await after?.(tx.db);
    });
    return statements.length;
  }
  const runEach = async (): Promise<void> => {
    for (const [index, statement] of statements.entries()) {
      try {
        await adapter.executeQuery(statement);
      } catch (error) {
        throw partialFailure(unit, index, statements.length, error);
      }
    }
  };
  if (adapter.getCapabilities().dialect === "sqlite") {
    const session: SqliteForeignKeySession = {
      read: statement => adapter.executeQuery(statement),
      run: async statement => {
        await adapter.executeQuery(statement);
      },
    };
    await withSqliteForeignKeysOff(session, async () => {
      await assertForeignKeysOff(session);
      await refusingNewDanglingReferences(
        session,
        runEach,
        (count, pairs) =>
          `${unit.source} ran outside a transaction, and left ${String(count)} row(s) referencing rows that do not exist (${pairs}). Its statements stayed applied: repair or remove those rows${unit.direction === "down" ? "" : `, then ${markAppliedAdvice(unit.source)}`}.`
      );
    });
  } else {
    await runEach();
  }
  await after?.(adapter.getDrizzle());
  return statements.length;
}

/**
 * How the operator records a unit whose statements were completed by hand:
 * an app file is marked applied; a plugin module's failed attempt is cleared
 * and `nextly migrate` records it, because recording a module also records
 * the tables it owns, which only `nextly migrate` does.
 */
function markAppliedAdvice(source: string): string {
  return isPluginLedgerRow(source)
    ? `run \`nextly migrate:resolve --failed-cleanup ${source}\` and then \`nextly migrate\`, which records it applied`
    : `mark it applied with \`nextly migrate:resolve --applied ${source}\``;
}

/**
 * What the operator does about a unit that ran outside a transaction and
 * stopped part-way. A unit finished by hand is recorded, never run again:
 * running it would repeat the statements that already ran. A unit whose
 * statements were reversed by hand stands at its start, and runs again.
 */
export function partiallyAppliedAdvice(source: string): string {
  return `If you finish its remaining statements by hand, ${markAppliedAdvice(source)} rather than running it again; if you reverse the statements that ran, run \`nextly migrate\` again.`;
}

/**
 * The error for a unit run outside a transaction whose statement at `index`
 * failed: which statement, how many before it stayed applied, and what to
 * do about them.
 *
 * The database's own reason is kept out of the public message — a driver's
 * text can carry identifiers and values from the statement — and travels in
 * `logMessage` and `cause`, which the CLI prints and the ledger records.
 */
function partialFailure(
  unit: MigrationUnit,
  index: number,
  total: number,
  error: unknown
): NextlyError {
  const { source } = unit;
  const reason = error instanceof Error ? error.message : String(error);
  const advice =
    unit.direction === "down"
      ? "Finish or reverse them by hand before running it again."
      : partiallyAppliedAdvice(source);
  const kept =
    index === 0
      ? "No statement before it had run, so it can run again once the cause is fixed."
      : `The ${String(index)} statement(s) before it stayed applied, and were not undone. ${advice}`;
  return new NextlyError({
    code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
    publicMessage: `${source} ran outside a transaction, and its statement ${String(index + 1)} of ${String(total)} failed. ${kept}`,
    logMessage: `${source}: statement ${String(index + 1)} of ${String(total)} failed: ${reason}`,
    logContext: {
      source,
      failedStatement: index + 1,
      statements: total,
      reason: "partially-applied",
    },
    ...(error instanceof Error ? { cause: error } : {}),
  });
}
