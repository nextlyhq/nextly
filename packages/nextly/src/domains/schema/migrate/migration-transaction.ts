/**
 * The one transaction every migration unit runs in — an app migration file,
 * a plugin module's UP, a DOWN — on one connection.
 *
 * @module domains/schema/migrate/migration-transaction
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SqlParam,
  StatementSession,
  SupportedDialect,
} from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { PgDialect } from "drizzle-orm/pg-core";

import { NextlyError } from "../../../errors/nextly-error";
import { assertNoOpenTransaction } from "../../../shared/lib/open-transaction";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import {
  causeChain,
  endedWaiting,
  ownSessionId,
  ownSessionIdText,
  sessionIdOfRows,
} from "../busy-table/ended-waiting";
import { isPluginLedgerRow } from "../events/ledger-scope";
import {
  assertSchemaLockHeld,
  markedForSchemaLock,
} from "../pipeline/schema-lock";

import { commitsOnMysql } from "./mysql-implicit-commit";
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
   * Told each statement's index as it is sent, after its checkpoint: a try that ends between
   * `onStatement` and this waited in the checkpoint, and the statement itself never reached the
   * database.
   */
  readonly onSend?: (index: number) => void;
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
export async function boundSqliteWait(
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

/** MySQL's per-try bounds, whole seconds half a second past the try: metadata locks and rows. */
function mysqlTryBounds(tryMs: number): string[] {
  const seconds = String(Math.ceil((tryMs + 500) / 1000));
  return [
    `SET SESSION lock_wait_timeout = ${seconds}`,
    `SET SESSION innodb_lock_wait_timeout = ${seconds}`,
  ];
}

/** What sets MySQL's per-try bounds back to the server's own defaults. */
const MYSQL_TRY_BOUNDS_RESET = [
  "SET SESSION lock_wait_timeout = DEFAULT",
  "SET SESSION innodb_lock_wait_timeout = DEFAULT",
];

/**
 * Runs `work` in a MySQL transaction with each wait for a lock, a table's metadata lock or a
 * row's, bounded half a second past the try, as a backstop for a watch that could not ask (a pool
 * with no connection to spare). A session setting outlives the transaction on its pooled
 * connection, so both are set back to the server's defaults before the transaction ends,
 * whatever its outcome. Anywhere else, `work` runs as it is.
 */
async function withMysqlTryBackstop<T>(
  tx: MigrationTransaction,
  dialect: SupportedDialect,
  bound: StatementTryBound | undefined,
  work: () => Promise<T>
): Promise<T> {
  if (bound === undefined || dialect !== "mysql") return work();
  for (const statement of mysqlTryBounds(bound.tryMs))
    await tx.execute(statement);
  try {
    return await work();
  } finally {
    for (const statement of MYSQL_TRY_BOUNDS_RESET) {
      await tx.execute(statement).catch(() => undefined);
    }
  }
}

/**
 * Bounds a try in a transaction on PostgreSQL (`SET LOCAL lock_timeout`, half a second past the
 * try, as a backstop for the watch) and tells the try the transaction's session, so the watch can
 * follow it; on MySQL the session alone (its bounds are `withMysqlTryBackstop`'s). Nothing on
 * SQLite, whose busy timeout bounds the unit.
 */
async function boundTransactionTry(
  tx: MigrationTransaction,
  dialect: SupportedDialect,
  bound: StatementTryBound | undefined
): Promise<void> {
  if (bound === undefined || dialect === "sqlite") return;
  if (dialect === "postgresql") {
    await tx.execute(
      `SET LOCAL lock_timeout = '${String(Math.round(bound.tryMs) + 500)}ms'`
    );
  }
  const session = await tx.session();
  if (session !== undefined) bound.onSession?.(session);
}

/**
 * Sends one statement of a transaction, passing over a failure the try tolerates where the
 * transaction can go on after it: only on MySQL, which rolls back the statement alone.
 */
async function executeTolerated(
  tx: MigrationTransaction,
  marked: string,
  statement: string,
  dialect: SupportedDialect,
  bound: StatementTryBound | undefined
): Promise<void> {
  try {
    await tx.execute(marked);
  } catch (error) {
    if (dialect !== "mysql" || !passesOver(bound, error, statement, dialect)) {
      throw error;
    }
  }
}

/** MySQL's ER_LOCK_DEADLOCK: the transaction was rolled back whole, the deadlock's victim. */
const MYSQL_DEADLOCK = { code: "ER_LOCK_DEADLOCK", errno: 1213 };

/**
 * Whether a try passes over `statement`'s failure: the caller's `passOver` accepts it, and it is
 * not one that ended the try or the transaction. A lock wait ended or cancelled is the try's to
 * judge, never a statement already applied, and a MySQL deadlock rolled back the whole
 * transaction, so the unit cannot go on in it.
 */
function passesOver(
  bound: StatementTryBound | undefined,
  error: unknown,
  statement: string,
  dialect: SupportedDialect
): boolean {
  if (bound?.passOver === undefined) return false;
  if (endedWaiting(error, dialect, true)) return false;
  const deadlock = causeChain(error).some(
    ({ code, errno }) =>
      code === MYSQL_DEADLOCK.code || errno === MYSQL_DEADLOCK.errno
  );
  return !deadlock && bound.passOver(error, statement);
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
export async function boundSessionTry<T>(
  session: StatementSession,
  dialect: "postgresql" | "mysql",
  bound: StatementTryBound,
  work: () => Promise<T>
): Promise<T> {
  // Fixed text with a whole number of milliseconds or seconds, never caller input.
  const setting =
    dialect === "postgresql"
      ? [`SET lock_timeout = '${String(Math.round(bound.tryMs) + 500)}ms'`]
      : mysqlTryBounds(bound.tryMs);
  for (const statement of setting) await session.execute(statement);
  const query = ownSessionIdText(dialect);
  const id =
    query === undefined
      ? undefined
      : sessionIdOfRows(await session.execute<Record<string, unknown>>(query));
  if (id !== undefined) bound.onSession?.(id);
  try {
    return await work();
  } finally {
    const reset =
      dialect === "postgresql"
        ? ["RESET lock_timeout"]
        : MYSQL_TRY_BOUNDS_RESET;
    for (const statement of reset) {
      await session.execute(statement).then(
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
    await executeTransaction(adapter, tx =>
      withMysqlTryBackstop(tx, dialect, bound, async () => {
        await boundTransactionTry(tx, dialect, bound);
        for (const setting of settingsBefore) await tx.execute(sent(setting));
        for (const [offset, statement] of statements.slice(from).entries()) {
          const index = from + offset;
          // A run that lost the lock starts no further statement (`assertSchemaLockHeld`).
          await assertSchemaLockHeld();
          await bound?.beforeStatement?.();
          // Told before the statement's checkpoint, which belongs to it: a wait the checkpoint
          // ends on is the statement's, so a try that resumes starts at it, never before it.
          bound?.onStatement?.(index);
          await checkpoint?.(tx.db, index);
          // A cancel the checkpoint's wait drew is settled before the statement is sent.
          await bound?.beforeStatement?.();
          bound?.onSend?.(index);
          await executeTolerated(
            tx,
            sent(statement),
            statement,
            dialect,
            bound
          );
          // MySQL committed the transaction at this statement and left the session in autocommit:
          // the transaction opens again, so the statements after it roll back together.
          if (dialect === "mysql" && commitsOnMysql(statement)) {
            await tx.execute("START TRANSACTION");
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
        // Not on MySQL, whose DDL committed as it ran: the file has landed by now, and refusing
        // here would report it as not recorded.
        if (dialect !== "mysql") await assertSchemaLockHeld();
      })
    );
    return statements.length;
  }
  // On SQLite outside a transaction each statement takes the write lock anew, and the busy timeout
  // bounds each wait on its own, so several waits could add up past the try. The try has one
  // deadline instead: before each statement the timeout is set to what is left of it, at least a
  // millisecond, so the waits together end within the try. A statement that has the lock at once
  // waits for nothing, whatever is left.
  const sqliteDeadline =
    dialect === "sqlite" && bound !== undefined
      ? performance.now() + bound.tryMs
      : undefined;
  const runEach = async (
    execute: (statement: string) => Promise<unknown>,
    // What the checkpoints read through: the connection the statements run on where a session
    // holds one, so a checkpoint neither waits for a pooled connection the session holds nor
    // escapes the try's bounds.
    checkpointDb: unknown
  ): Promise<void> => {
    for (const setting of settingsBefore) await execute(sent(setting));
    for (const [offset, statement] of statements.slice(from).entries()) {
      const index = from + offset;
      // Asked before the statement, outside the failure below: refused here, nothing of it ran.
      await assertSchemaLockHeld();
      await bound?.beforeStatement?.();
      // Told before the statement's checkpoint, which belongs to it: the statements before it
      // committed as they ran, so a try that ends in the checkpoint resumes at this statement and
      // never sends the one before it again.
      bound?.onStatement?.(index);
      // Outside a transaction each statement has committed, so the checkpoint reads what they
      // left. The refusal names the statements that ran and says they stayed applied, so it
      // reaches the caller as it is, not as a statement that failed part-way.
      await checkpoint?.(checkpointDb, index);
      // A cancel the checkpoint's wait drew is settled before the statement is sent.
      await bound?.beforeStatement?.();
      bound?.onSend?.(index);
      if (sqliteDeadline !== undefined) {
        // A whole number of milliseconds, never caller input.
        const left = Math.max(
          1,
          Math.round(sqliteDeadline - performance.now())
        );
        await adapter.executeQuery(`PRAGMA busy_timeout = ${String(left)}`);
      }
      try {
        await execute(sent(statement));
      } catch (error) {
        if (passesOver(bound, error, statement, dialect)) continue;
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
        () => runEach(onPool, adapter.getDrizzle()),
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
        const each = () =>
          runEach(
            statement => session.execute(statement),
            sessionReader(session, dialect)
          );
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
        runEach(
          statement => session.execute(statement),
          sessionReader(session, dialect)
        )
      )
    );
  } else {
    await runEach(onPool, adapter.getDrizzle());
  }
  if (after !== undefined) {
    await assertSchemaLockHeld();
    await afterBounded(adapter, dialect, bound, db =>
      after(db, statements.length)
    );
  }
  return statements.length;
}

/**
 * Runs a unit's `after` (its ledger write) once its statements have run outside a transaction,
 * bounded as the try was: on PostgreSQL and MySQL in a short transaction of its own whose lock
 * waits end half a second past the try, so a ledger table another session holds ends the try as
 * a busy table does, and the next try, which resumes past every statement, writes it again. The
 * session the statements ran on has closed by now, so this takes no connection a one-connection
 * pool has to spare. On SQLite, whose busy timeout still bounds the connection, and where no try
 * is bounded, it runs as it did, through the adapter's own handle.
 */
async function afterBounded(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  bound: StatementTryBound | undefined,
  write: (db: unknown) => Promise<void>
): Promise<void> {
  if (bound === undefined || dialect === "sqlite") {
    await write(adapter.getDrizzle());
    return;
  }
  await executeTransaction(adapter, tx =>
    withMysqlTryBackstop(tx, dialect, bound, async () => {
      if (dialect === "postgresql") {
        // Fixed text with a whole number of milliseconds, never caller input.
        await tx.execute(
          `SET LOCAL lock_timeout = '${String(Math.round(bound.tryMs) + 500)}ms'`
        );
      }
      await write(tx.db);
    })
  );
}

/**
 * A reader over the session the unit's statements run on, shaped as the adapter's own Drizzle
 * handle answers `execute` (PostgreSQL's `{ rows }`, MySQL's `[rows, fields]`), for the
 * required-column checkpoints, which read through `execute` alone on these dialects.
 */
function sessionReader(
  session: StatementSession,
  dialect: "postgresql" | "mysql"
): { execute(query: SQL): Promise<unknown> } {
  const compiler =
    dialect === "postgresql" ? new PgDialect() : new MySqlDialect();
  return {
    execute: async (query: SQL) => {
      const compiled = compiler.sqlToQuery(query);
      const rows = await session.execute(
        compiled.sql,
        compiled.params as SqlParam[]
      );
      return dialect === "postgresql" ? { rows } : [rows, []];
    },
  };
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
