/**
 * The one transaction every migration unit runs in — an app migration file,
 * a plugin module's UP, a DOWN — on one connection.
 *
 * @module domains/schema/migrate/migration-transaction
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  StatementSession,
  SupportedDialect,
} from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import { assertNoOpenTransaction } from "../../../shared/lib/open-transaction";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import {
  ownSessionId,
  ownSessionIdText,
  sessionIdOfRows,
} from "../busy-table/ended-waiting";
import { isPluginLedgerRow } from "../events/ledger-scope";
import {
  assertSchemaLockHeld,
  markedForSchemaLock,
} from "../pipeline/schema-lock";

import { requiredColumnCheckpoint } from "./required-column-guard";
import { leadingWords } from "./split-sql";
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
  /**
   * Puts back the connection's own settings that a unit's statements may
   * have changed for the rest of the transaction, before the runner writes
   * through `db` (`restoreSessionDefaults`).
   */
  restoreSession(): Promise<void>;
  /**
   * The database's id for the connection the unit's statements run on (PostgreSQL's pid, MySQL's
   * connection id), so a try for a busy table can be watched from another; undefined on SQLite.
   */
  session(): Promise<string | undefined>;
}

/**
 * One try for a busy table, as the runner bounds it (`busy-table/run-unit`): the try's bound, and
 * what the runner tells the tries about the try as it goes.
 */
export interface StatementTryBound {
  /** How long one try may wait for locks, in milliseconds. */
  readonly tryMs: number;
  /** Told the id of the connection the unit's statements run on, once it is known. */
  readonly onSession?: (session: string) => void;
  /**
   * Told each statement's index just before it is sent, and the number of statements once every
   * one has run, so a wait after the last (the ledger's write) is told apart from one on it.
   */
  readonly onStatement?: (index: number) => void;
  /**
   * The index of the first statement this try sends, 0 by default: the statements before it were
   * made durable by an earlier try and are not sent again, except a connection setting (`SET`),
   * which is sent again first so it is in force on this try's connection. Indexes stay those of
   * the whole unit, for `onStatement` and the required-column count alike.
   */
  readonly from?: number;
  /**
   * Awaited once every statement has run, before the unit's ledger write and its commit, while
   * the try's connection still runs this unit: the try's watch stops here, so nothing it sends can
   * reach a connection the pool has since handed to other work.
   */
  readonly settle?: () => Promise<void>;
  /**
   * Awaited before each statement is sent: the try's watch finishes a cancel under way first, so
   * a cancel meant for the statement that waited can never end the next one.
   */
  readonly beforeStatement?: () => Promise<void>;
  /**
   * A statement whose failure this accepts is passed over, and the unit goes on to the next, as
   * a runner that tolerates a statement already applied does; it counts as run. Honoured only
   * where a refused statement leaves the unit able to go on: outside a transaction, and on MySQL,
   * which rolls back the statement alone. In a PostgreSQL or SQLite transaction a refused
   * statement aborts the transaction, so there it is never consulted.
   */
  readonly passOver?: (error: unknown, statement: string) => boolean;
}

/**
 * What PostgreSQL resets before the runner's own writes in a unit's
 * transaction: the settings a unit may change with SET LOCAL that decide
 * which table an unqualified name reaches, and with what rights. Fixed
 * keywords, never built from input.
 */
const POSTGRES_SESSION_RESETS = [
  "RESET SESSION AUTHORIZATION",
  "RESET ROLE",
  "RESET search_path",
] as const;

/**
 * Restores, inside the transaction, the settings a PostgreSQL unit may have
 * changed with `SET LOCAL search_path`, `SET LOCAL ROLE` or
 * `SET LOCAL SESSION AUTHORIZATION`, so the ledger and owner tables the
 * runner writes after the statements, by their unqualified names, are the
 * ones the connection was opened on, written with its own rights.
 *
 * RESET returns a setting to its session default: the value the connection
 * started with, which includes a `search_path` the adapter sets in its
 * startup options for a configured schema. Inside a transaction it undoes a
 * SET LOCAL, and like one ends with the transaction. A plain SET, which
 * would outlive the unit, is refused before anything runs
 * (`statementRefusals`).
 */
async function restoreSessionDefaults(ctx: {
  runStatement(statement: ReturnType<typeof sql.raw>): Promise<void>;
}): Promise<void> {
  for (const reset of POSTGRES_SESSION_RESETS) {
    await ctx.runStatement(sql.raw(reset));
  }
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
  // A precondition, on every dialect: a transaction opened inside another
  // joins it, and a migration must not. On MySQL its DDL would commit the
  // outer transaction implicitly; on SQLite the foreign-key switch it needs
  // does nothing inside one.
  assertNoOpenTransaction(adapter, "A migration");
  const dialect = adapter.getCapabilities().dialect;
  if (dialect !== "sqlite") {
    return adapter.transaction(
      ctx =>
        work({
          execute: async statement => {
            await ctx.execute(statement);
          },
          db: ctx.getDrizzle(),
          // MySQL has no transaction-scoped setting a unit can change that
          // reroutes a table name: `USE` is refused before anything runs.
          restoreSession: () =>
            dialect === "postgresql"
              ? restoreSessionDefaults(ctx)
              : Promise.resolve(),
          session: async () => {
            const query = ownSessionId(dialect);
            if (query === undefined) return undefined;
            return sessionIdOfRows(
              await ctx.queryStatement<Record<string, unknown>>(query)
            );
          },
        }),
      // A migration runs with nobody there to read a warning, so on MySQL it
      // runs in strict mode whatever the server's own mode: a statement that
      // would cut a value short, such as a column narrowed below a stored
      // value's length, fails and changes nothing instead.
      dialect === "mysql" ? { strictSqlMode: true } : undefined
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
            db: ctx.getDrizzle(),
            // SQLite has no setting a statement can change that reroutes a
            // table name: ATTACH and DETACH are refused before anything runs.
            restoreSession: () => Promise.resolve(),
            // SQLite names no connection: its busy timeout bounds the one write lock.
            session: () => Promise.resolve(undefined),
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
 * runs inside that transaction, with its Drizzle handle and the number of
 * statements run, for a ledger row that must commit or roll back with the
 * statements it records; if it throws, the transaction rolls back. Before
 * it runs, the connection's own settings are put back
 * (`restoreSessionDefaults`), so a unit's SET LOCAL does not reroute it.
 *
 * Outside one: each statement runs on its own through the adapter and commits
 * as it runs, which is what lets PostgreSQL's `CREATE INDEX CONCURRENTLY`
 * run at all. A statement that fails stops the unit, and nothing undoes the
 * statements before it; the error says how many of them stayed applied.
 * `after` runs once every statement has, with the adapter's own handle. On
 * MySQL the statements share one connection whose session runs in strict
 * mode, as a unit run in a transaction does, so a statement that would cut a
 * stored value short fails rather than applying with a warning.
 *
 * Bounded as one try for a busy table (`bound`), a unit is watched on the connection its
 * statements run on: in a transaction, the transaction's; outside one on the servers, one
 * connection a session holds for the whole unit (`boundSessionTry`). A try that resumes
 * (`bound.from`) skips the statements an earlier try made durable.
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
  after?: (db: unknown, statementsExecuted: number) => Promise<void>,
  bound?: StatementTryBound
): Promise<number> {
  // On SQLite one try's bound is the busy timeout of the one connection, for every wait of the
  // unit, set before it and put back after it whatever its outcome.
  if (bound !== undefined && adapter.getCapabilities().dialect === "sqlite") {
    const restore = await boundSqliteWait(adapter, bound.tryMs);
    try {
      return await runUnitStatements(adapter, statements, unit, after, bound);
    } finally {
      await restore();
    }
  }
  return runUnitStatements(adapter, statements, unit, after, bound);
}

/**
 * Sets SQLite's busy timeout to `tryMs` and returns what puts the connection's own back. Putting
 * it back is best effort: the unit has already ended, and a failure here must not change how.
 */
async function boundSqliteWait(
  adapter: DrizzleAdapter,
  tryMs: number
): Promise<() => Promise<void>> {
  const [row] = await adapter.executeQuery<Record<string, unknown>>(
    "PRAGMA busy_timeout"
  );
  const previous = Number(Object.values(row ?? {})[0] ?? 0);
  await adapter.executeQuery(
    `PRAGMA busy_timeout = ${String(Math.round(tryMs))}`
  );
  return () =>
    adapter
      .executeQuery(
        `PRAGMA busy_timeout = ${String(Number.isFinite(previous) ? previous : 0)}`
      )
      .then(
        () => undefined,
        () => undefined
      );
}

/**
 * Whether `statement` sets something on its connection (`SET`): sent again before a try that
 * resumes past it, since the try may run on another connection than the one it was set on.
 */
export function isConnectionSetting(
  statement: string,
  dialect: SupportedDialect
): boolean {
  return leadingWords(statement, dialect, 1)[0] === "SET";
}

/**
 * Bounds each lock wait of a session that runs a unit outside a transaction, half a second past
 * the try's bound, as a backstop for a watch that could not ask; and tells the try the session's
 * id, so the watch can follow it. The session is one `withSession` holds and closes afterwards,
 * so the setting ends with it; on PostgreSQL it is put back all the same, best effort, before the
 * session runs anything else.
 */
async function boundSessionTry<T>(
  session: StatementSession,
  dialect: "postgresql" | "mysql",
  bound: StatementTryBound,
  work: () => Promise<T>
): Promise<T> {
  // Fixed text with a whole number of milliseconds or seconds, never caller input.
  await session.execute(
    dialect === "postgresql"
      ? `SET lock_timeout = '${String(Math.round(bound.tryMs) + 500)}ms'`
      : `SET SESSION lock_wait_timeout = ${String(Math.ceil((bound.tryMs + 500) / 1000))}`
  );
  const query = ownSessionIdText(dialect);
  const id =
    query === undefined
      ? undefined
      : sessionIdOfRows(await session.execute<Record<string, unknown>>(query));
  if (id !== undefined) bound.onSession?.(id);
  try {
    return await work();
  } finally {
    if (dialect === "postgresql") {
      await session.execute("RESET lock_timeout").then(
        () => undefined,
        () => undefined
      );
    }
  }
}

/** `runMigrationStatements`'s unit, run once, bounded as one try where `bound` is given. */
async function runUnitStatements(
  adapter: DrizzleAdapter,
  statements: readonly string[],
  unit: MigrationUnit,
  after:
    | ((db: unknown, statementsExecuted: number) => Promise<void>)
    | undefined,
  bound: StatementTryBound | undefined
): Promise<number> {
  const dialect = adapter.getCapabilities().dialect;
  // A column made required after an earlier statement of the unit filled its rows is counted at
  // its statement, after the fill, through the handle the statements run on; undefined when the
  // unit has no such column, so this costs nothing.
  const checkpoint = requiredColumnCheckpoint(statements, dialect, unit);
  // Each statement is marked with the lock's claim on the servers, where a run taking over a
  // lapsed lock looks for an earlier holder's statements still running. SQLite runs one writer at
  // a time, so a taker cannot start while a statement of the holder runs, and its adapter reads a
  // statement's first word.
  // The unit's name goes with the claim, so a run refused by one of these statements names the
  // file, never the statement's text.
  const sent = (statement: string) =>
    dialect === "sqlite"
      ? statement
      : markedForSchemaLock(statement, unit.source);
  // A try that resumes starts at `from`; the settings made before it are made again first.
  const from = Math.max(0, Math.min(bound?.from ?? 0, statements.length));
  const settingsBefore = statements
    .slice(0, from)
    .filter(statement => isConnectionSetting(statement, dialect));
  if (unit.transaction) {
    await executeTransaction(adapter, async tx => {
      // On MySQL each metadata lock is bounded by the session's `lock_wait_timeout`, half a second
      // past the try, as a backstop for a watch that could not ask. A session setting outlives the
      // transaction on its pooled connection, so it is set back to the server's own default before
      // the transaction ends, whatever its outcome.
      const mysqlBackstop = bound !== undefined && dialect === "mysql";
      if (mysqlBackstop) {
        await tx.execute(
          `SET SESSION lock_wait_timeout = ${String(Math.ceil((bound.tryMs + 500) / 1000))}`
        );
      }
      try {
        if (bound !== undefined && dialect !== "sqlite") {
          if (dialect === "postgresql") {
            // The watch on this session ends the try once its waits add up to the bound, having
            // read what holds the table first. Each lock is also bounded by the database, half a
            // second later, as a backstop for a watch that could not ask. MySQL's per-lock bound
            // is a session setting that would outlive the transaction on its pooled connection, so
            // there the watch alone bounds the try.
            await tx.execute(
              `SET LOCAL lock_timeout = '${String(Math.round(bound.tryMs) + 500)}ms'`
            );
          }
          const session = await tx.session();
          if (session !== undefined) bound.onSession?.(session);
        }
        for (const setting of settingsBefore) await tx.execute(sent(setting));
        for (const [offset, statement] of statements.slice(from).entries()) {
          const index = from + offset;
          await checkpoint?.(tx.db, index);
          // A run that lost the lock starts no further statement (`assertSchemaLockHeld`).
          await assertSchemaLockHeld();
          await bound?.beforeStatement?.();
          bound?.onStatement?.(index);
          try {
            await tx.execute(sent(statement));
          } catch (error) {
            // Only MySQL's transaction goes on after a refused statement (see `passOver`).
            if (
              dialect !== "mysql" ||
              bound?.passOver?.(error, statement) !== true
            ) {
              throw error;
            }
          }
        }
        bound?.onStatement?.(statements.length);
        await bound?.settle?.();
        // A unit may rewrite registry rows (a schema save's upsert of its own
        // row): what the transaction read of them before is read again.
        clearRegistryRowCache();
        if (after !== undefined) {
          await tx.restoreSession();
          await after(tx.db, statements.length);
        }
        // The commit is what lands the file: refused, and the transaction undone, as a statement.
        // Not on MySQL, whose DDL committed as it ran: the file has landed by now, and refusing here
        // would report it as not recorded.
        if (dialect !== "mysql") await assertSchemaLockHeld();
      } finally {
        if (mysqlBackstop) {
          await tx
            .execute("SET SESSION lock_wait_timeout = DEFAULT")
            .catch(() => undefined);
        }
      }
    });
    return statements.length;
  }
  const runEach = async (
    execute: (statement: string) => Promise<unknown>
  ): Promise<void> => {
    for (const setting of settingsBefore) await execute(sent(setting));
    for (const [offset, statement] of statements.slice(from).entries()) {
      const index = from + offset;
      // Outside a transaction each statement has committed, so the pool reads what they left. The
      // refusal names the statements that ran and says they stayed applied, so it reaches the
      // caller as it is, not as a statement that failed part-way.
      await checkpoint?.(adapter.getDrizzle(), index);
      // Asked before the statement, outside the failure below: refused here, nothing of it ran.
      await assertSchemaLockHeld();
      await bound?.beforeStatement?.();
      bound?.onStatement?.(index);
      try {
        await execute(sent(statement));
      } catch (error) {
        if (bound?.passOver?.(error, statement) === true) continue;
        throw partialFailure(unit, index, statements.length, error);
      }
    }
    bound?.onStatement?.(statements.length);
    await bound?.settle?.();
  };
  const onPool = (statement: string) => adapter.executeQuery(statement);
  if (dialect === "sqlite") {
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
        () => runEach(onPool),
        (count, pairs) =>
          `${unit.source} ran outside a transaction, and left ${String(count)} row(s) referencing rows that do not exist (${pairs}). Its statements stayed applied: repair or remove those rows${unit.direction === "down" ? "" : `, then ${markAppliedAdvice(unit.source)}`}.`
      );
    });
  } else if (dialect === "mysql") {
    // Strict mode, as `executeTransaction` gives a unit run in a transaction:
    // a statement that would cut a value short, such as a column narrowed
    // below a stored value's length, fails instead of applying with a
    // warning nobody reads. A session setting covers only its own
    // connection, so every statement runs on the one connection the session
    // holds, which is closed afterwards rather than pooled.
    await adapter.withSession(
      session => {
        const each = () => runEach(statement => session.execute(statement));
        return bound === undefined
          ? each()
          : boundSessionTry(session, dialect, bound, each);
      },
      { strictSqlMode: true }
    );
  } else if (bound !== undefined) {
    // A try is watched on one session, so a bounded unit runs on one connection the session
    // holds and closes afterwards, rather than each statement on whichever pooled one is free.
    await adapter.withSession(session =>
      boundSessionTry(session, dialect, bound, () =>
        runEach(statement => session.execute(statement))
      )
    );
  } else {
    await runEach(onPool);
  }
  if (after !== undefined) {
    await assertSchemaLockHeld();
    await after(adapter.getDrizzle(), statements.length);
  }
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
 * What the operator does about a unit that stopped part-way. A unit finished
 * by hand is recorded, never run again: running it would repeat the
 * statements that already ran. A unit whose statements were reversed by hand
 * stands at its start, and runs again once its failed attempt is cleared:
 * while that attempt is the newest, `nextly migrate` refuses to run it,
 * because it cannot tell a reversed unit from one whose data statements
 * stayed.
 */
export function partiallyAppliedAdvice(source: string): string {
  return `If you finish its remaining statements by hand, ${markAppliedAdvice(source)} rather than running it again; if you reverse the statements that ran, run \`nextly migrate:resolve --failed-cleanup ${source}\` and then \`nextly migrate\` again.`;
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
