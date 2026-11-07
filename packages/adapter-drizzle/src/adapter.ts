/**
 * Base database adapter abstract class.
 *
 * @remarks
 * This abstract class provides the foundation for all dialect-specific database adapters
 * (PostgreSQL, MySQL, SQLite). It defines required abstract methods that must be implemented
 * by subclasses, while providing default implementations for CRUD operations and query building.
 *
 * Dialect adapters can override any default method to provide optimized implementations.
 *
 * @packageDocumentation
 */

import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";

import { count, getColumns, sql } from "drizzle-orm";
import type { AnyRelations, SQL } from "drizzle-orm";

import {
  bindStructuredAsJson,
  isJsonColumn,
  type ColumnKindInput,
} from "./column-kinds";
import { buildDrizzleOrderBy } from "./drizzle-order";
import { buildDrizzleWhere } from "./drizzle-where";
import {
  pinTransactions,
  type DrizzleTransactor,
  type PinnedConnection,
} from "./pinned-transaction";
import { type CatalogExecutor, tableExistsOn } from "./table-exists";
import {
  createTransactionForwarders,
  transactionDrizzleHandles,
  type TransactionCrudForwarders,
} from "./transaction-forwarders";
import {
  closeFrame,
  enqueueIn,
  joinable,
  openFrame,
  outermost,
  settleNested,
  undone,
  type Committed,
  type HeldEffect,
  type JoinableFrame,
  type JoinSteps,
  type OutermostSteps,
  type Settled,
  type TransactionAttempts,
  type TransactionFrame,
  type TransactionSteps,
} from "./transaction-frame";
import type {
  SupportedDialect,
  SqlParam,
  WhereClause,
  WhereCondition,
  CountOptions,
  SelectOptions,
  InsertOptions,
  UpdateOptions,
  DeleteOptions,
  UpsertOptions,
  TransactionContext,
  TransactionOptions,
  SessionOptions,
  StatementSession,
  DatabaseCapabilities,
  PoolStats,
  DatabaseError,
  DatabaseErrorKind,
  Migration,
  MigrationResult,
  TableDefinition,
  CreateTableOptions,
  DropTableOptions,
  AlterTableOptions,
  AlterTableOperation,
  TableResolver,
} from "./types";
import {
  createDatabaseError,
  isApplicationError,
  isDatabaseError,
  tableNotRegisteredError,
} from "./types";
import { buildUpdateStatement } from "./update-statement";

/**
 * Where a test harness installs the observer {@link DrizzleAdapter.notePoolAccess}
 * reports a transaction escape to: a global registry key rather than an
 * import, so the harness and every copy of this package agree on it.
 */
const TRANSACTION_ESCAPE_OBSERVER = Symbol.for(
  "nextly.transactionEscapeObserver"
);

/** What a test harness installed to hear about escapes, if anything. */
type EscapeObserver = (report: {
  dialect: string;
  stack: string;
  openedAt?: string;
  statement?: string;
}) => void;

/**
 * The SQL text a pool call was handed: a string, or the `text` (pg) or `sql`
 * (mysql2) of a query object. Undefined for a connection checkout.
 */
function statementOf(argument: unknown): string | undefined {
  if (typeof argument === "string") return argument;
  if (typeof argument !== "object" || argument === null) return undefined;
  const { text, sql } = argument as { text?: unknown; sql?: unknown };
  if (typeof text === "string") return text;
  return typeof sql === "string" ? sql : undefined;
}

/** The escape observer a test harness installed; undefined in production. */
function escapeObserver(): EscapeObserver | undefined {
  const observe = (globalThis as Record<symbol, unknown>)[
    TRANSACTION_ESCAPE_OBSERVER
  ];
  return typeof observe === "function"
    ? (observe as EscapeObserver)
    : undefined;
}

/**
 * The current stack, deep enough to reach the code that made the query. The
 * driver's and Drizzle's own frames fill V8's default of ten, which cut every
 * report off before its caller. Raised only for this capture and restored
 * after, so nothing else sees the deeper limit; it runs only for an observer a
 * test harness installed.
 */
function deepStack(): string {
  const limit = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = 64;
    return new Error().stack ?? "";
  } finally {
    Error.stackTraceLimit = limit;
  }
}

/** The stack that opens a transaction, while a test harness observes escapes. */
function openingStack(): string | undefined {
  return escapeObserver() === undefined ? undefined : deepStack();
}

/**
 * The first outermost transaction around `frame` that `test` accepts: the one
 * `frame` belongs to, then each one the flow that opened it was inside.
 */
function transactionAround(
  frame: TransactionFrame | undefined,
  test: (transaction: TransactionFrame) => boolean
): TransactionFrame | undefined {
  for (let at = frame; at !== undefined; ) {
    const transaction = outermost(at);
    if (test(transaction)) return transaction;
    at = transaction.enclosing;
  }
  return undefined;
}

/** Waits `ms` before a transaction's next attempt. */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Whether a transaction step returned a promise. A synchronous driver's step
 * returns nothing and is not awaited, so the code after it runs in the same
 * tick, as it did when the dialect ran the statement itself.
 */
function isPending(outcome: unknown): outcome is Promise<unknown> {
  return outcome instanceof Promise;
}

/**
 * A Drizzle column that decodes its own driver representation.
 *
 * `dataType` is the dialect-independent kind ("string", "boolean", "date");
 * `mapFromDriverValue` turns what the driver handed back into the JS value a
 * Drizzle query would have produced.
 */
interface DecodableColumn {
  dataType: unknown;
  mapFromDriverValue(value: unknown): unknown;
  mapToDriverValue(value: unknown): unknown;
}

/**
 * Matches the `dataType` a Drizzle timestamp/datetime column reports, in both
 * the bare form and the object-qualified form some column classes carry.
 */
const DATE_DATA_TYPE = /(?:^|\s)date$/;

/**
 * How far an echoed timestamp may sit from the one that was bound and still
 * count as the same value.
 *
 * A column with no fractional precision keeps whole seconds, so a stored value
 * can differ from the bound one by up to a second without anything being wrong.
 * Every real UTC offset is at least fifteen minutes, so a shift is never
 * mistaken for rounding.
 */
/**
 * Stem for the alias a statement spells a timestamp's wall clock out under.
 *
 * Short on purpose. PostgreSQL truncates an identifier at 63 bytes, and a
 * truncated alias is worse than a rejected one: the statement still succeeds,
 * the lookup misses the name it asked for, and the row keeps both the driver's
 * value and a stray property. A stem plus an index stays far inside the limit
 * whatever the column is called.
 */
const WALL_CLOCK_ALIAS_STEM = "__nx_wc";

/**
 * A timestamp as the database itself spells it, in a fixed field order.
 *
 * Matched rather than handed to `new Date`, so nothing depends on the host's
 * parsing of a partial date. The fraction is optional and of any length, which
 * covers PostgreSQL's milliseconds and MySQL's microseconds alike.
 */
const WALL_CLOCK_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;

/**
 * Read a database's own rendering of a timestamp as UTC.
 *
 * The statement wrote a UTC wall clock, so reading one back as UTC is what
 * makes a write agree with a later read. The rendering is one the statement
 * asked for by name, so its shape does not depend on a session setting.
 *
 * Anything that does not match answers nothing, leaving the driver's value in
 * place rather than replacing it with an `Invalid Date`.
 */
function parseWallClockAsUtc(text: string): Date | undefined {
  const match = WALL_CLOCK_PATTERN.exec(text.trim());
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  // Milliseconds, whatever precision the dialect rendered: a shorter fraction
  // is padded and a longer one truncated, which is what a `Date` can hold.
  const millis = Number(`${fraction}000`.slice(0, 3));
  const parsed = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      millis
    )
  );
  // `Date.UTC` reads a year under 100 as shorthand for the 1900s, so year 50
  // would land in 1950. The database said 0050 and meant it.
  if (Number(year) < 100) parsed.setUTCFullYear(Number(year));
  return parsed;
}

/** Whether a table property is a date column that can convert its own values. */
function isDateColumn(colDef: unknown): colDef is DecodableColumn {
  if (!colDef || typeof colDef !== "object") return false;
  const candidate = colDef as Partial<DecodableColumn>;
  return (
    typeof candidate.mapFromDriverValue === "function" &&
    typeof candidate.mapToDriverValue === "function" &&
    DATE_DATA_TYPE.test(String(candidate.dataType))
  );
}

/**
 * Whether a date column records the zone its value belongs to.
 *
 * A column declared WITH a time zone stores an instant, so a driver reading it
 * back gets the same moment whatever zone either end is in -- there is nothing
 * ambiguous to resolve and nothing to correct. Rendering one as text would
 * spell it in the session's zone, and reading that as UTC would move it.
 */
function carriesTimeZone(colDef: unknown): boolean {
  return (colDef as { withTimezone?: unknown }).withTimezone === true;
}

/**
 * Abstract base class for database adapters.
 *
 * @remarks
 * All dialect-specific adapters must extend this class and implement the abstract methods.
 * Default implementations are provided for CRUD operations, which can be overridden for
 * optimization or dialect-specific behavior.
 *
 * ## Required Implementations
 *
 * Subclasses must implement:
 * - `dialect` - Database dialect identifier
 * - `connect()` - Establish database connection
 * - `disconnect()` - Close database connection
 * - `executeQuery()` - Execute raw SQL query
 * - `transaction()` - Execute operations within a transaction
 * - `getCapabilities()` - Report database feature support
 *
 * ## Optional Overrides
 *
 * Subclasses can override default CRUD methods for optimization:
 * - `select()`, `selectOne()` - Custom query optimization
 * - `insert()`, `insertMany()` - Bulk insert optimization
 * - `update()`, `delete()` - Custom update/delete logic
 * - `upsert()` - Dialect-specific upsert syntax
 *
 * @example
 * ```typescript
 * export class PostgresAdapter extends DrizzleAdapter {
 *   readonly dialect = 'postgresql' as const;
 *
 *   async connect() {
 *     this.pool = new Pool({ connectionString: this.config.url });
 *     // ... connection logic
 *   }
 *
 *   async executeQuery<T>(sql: string, params?: SqlParam[]) {
 *     const result = await this.pool.query(sql, params);
 *     return result.rows as T[];
 *   }
 *
 *   // ... other required methods
 * }
 * ```
 *
 * @public
 */
/**
 * Rows affected by a write, normalised across the driver shapes Drizzle returns.
 *
 * mysql2 resolves to `[ResultSetHeader, FieldPacket[]]`, so treating any array
 * as a row list reports the tuple length — a constant 2 whether the statement
 * matched nothing, one row, or many. Callers that branch on the count (a
 * conditional claim, a retention loop) silently get the wrong answer on MySQL,
 * so the header is read first. node-postgres reports `rowCount` and
 * better-sqlite3 reports `changes`; a plain array is a RETURNING row list, whose
 * length is the count.
 */
function affectedRowCount(result: unknown): number {
  if (Array.isArray(result)) {
    const header = result[0] as { affectedRows?: unknown } | undefined;
    if (header && typeof header.affectedRows === "number") {
      return header.affectedRows;
    }
    return result.length;
  }
  const record = result as Record<string, unknown> | null | undefined;
  const rowCount = record?.rowCount;
  if (typeof rowCount === "number") return rowCount;
  const changes = record?.changes;
  if (typeof changes === "number") return changes;
  return 0;
}

/**
 * The fragment of Drizzle's update builder `updateCount` uses, spelled dialect-neutrally.
 *
 * Declared rather than reached for through a permissive generic: the three dialects' builders carry
 * different type parameters but agree on this chain, so naming just the chain keeps the compiler
 * checking the call while leaving the parts that genuinely differ outside the contract. `set` is
 * awaitable on its own, which is what makes an update with no WHERE a complete statement rather
 * than a builder waiting for one.
 */
interface UpdateCapableDb {
  update(table: unknown): {
    set(values: Record<string, unknown>): PromiseLike<unknown> & {
      where(condition: unknown): PromiseLike<unknown>;
    };
  };
}

/** The one-column shape a count projection selects. */
interface CountRow {
  value: unknown;
}

/**
 * A `$dynamic()` count select, whose WHERE is applied only when there is one.
 *
 * Both branches are awaitable, which is the property that makes the conditional
 * work: the statement is a complete query with or without a condition, so
 * neither arm is a builder still waiting for something.
 */
interface CountableSelect extends PromiseLike<CountRow[]> {
  where(condition: unknown): PromiseLike<CountRow[]>;
}

/**
 * A `SELECT DISTINCT` that can still be named as a subquery after a WHERE.
 *
 * `where` returns the same shape rather than a thenable, because this select is
 * never executed on its own — it is aliased and counted over.
 */
interface AliasableSelect {
  where(condition: unknown): AliasableSelect;
  as(alias: string): unknown;
}

/**
 * The fragment of Drizzle's select builder `count` uses, spelled dialect-neutrally.
 *
 * Declared for the same reason as {@link UpdateCapableDb}: the three dialects' builders carry
 * different type parameters but agree on these chains, so naming just the chains keeps the compiler
 * checking the calls while leaving the parts that genuinely differ outside the contract. Casting to
 * `any` instead would compile whatever it was handed, so a dialect changing one of these signatures
 * would break counts at runtime with nothing failing at build time.
 */
interface CountCapableDb {
  select(projection: Record<string, unknown>): {
    from(source: unknown): PromiseLike<CountRow[]> & {
      $dynamic(): CountableSelect;
    };
  };
  selectDistinct(projection: Record<string, unknown>): {
    from(table: unknown): { $dynamic(): AliasableSelect };
  };
}

export abstract class DrizzleAdapter {
  // ============================================================
  // Abstract Methods (MUST be implemented by subclasses)
  // ============================================================

  /**
   * Database dialect identifier.
   *
   * @remarks
   * Must be set by subclass to identify the database type.
   */
  abstract readonly dialect: SupportedDialect;

  /**
   * Establish connection to the database.
   *
   * @remarks
   * This method should be idempotent - calling it multiple times
   * should not create multiple connections.
   *
   * @throws {DatabaseError} If connection fails
   */
  abstract connect(): Promise<void>;

  /**
   * Close database connection and release resources.
   *
   * @remarks
   * This method should be idempotent - calling it multiple times
   * should be safe.
   */
  abstract disconnect(): Promise<void>;

  /**
   * Execute a raw SQL query.
   *
   * @param sql - SQL query to execute
   * @param params - Query parameters
   * @returns Array of result rows
   *
   * @throws {DatabaseError} If query execution fails
   */
  abstract executeQuery<T = unknown>(
    sql: string,
    params?: SqlParam[]
  ): Promise<T[]>;

  /**
   * Execute operations within a database transaction.
   *
   * @remarks
   * The transaction is automatically committed on success or rolled back on error.
   * Supports nested transactions via savepoints on databases that support them.
   *
   * Two kinds of error leave this method, and a caller has to be able to tell
   * them apart. An error carrying the Nextly application brand — see
   * `isApplicationError` — arrives exactly as it was thrown, because that is
   * the application refusing the write rather than the database failing to
   * perform it, and rewriting it would discard the code and payload the caller
   * is meant to act on.
   *
   * Everything else arrives as a `DatabaseError` with its kind classified, and
   * that deliberately includes an unbranded error the callback itself threw:
   * the brand is the only thing distinguishing a deliberate refusal from a
   * driver failure that surfaced through callback code, and guessing from the
   * throw site would put raw driver text on the wire under a caller's own
   * error shape.
   *
   * The rollback is the same either way.
   *
   * @param callback - Function to execute within transaction
   * @param options - Transaction options
   * @returns Result from the callback
   *
   * @throws {DatabaseError} If the transaction itself fails, or if the callback
   * threw an error that does not carry the application brand
   * @throws The callback's own error, unchanged, when it carries that brand
   */
  abstract transaction<T>(
    callback: (ctx: TransactionContext) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T>;

  /**
   * Refuses a `withSession` call made while the calling flow is inside an
   * open transaction, before any connection is taken. On SQLite's one
   * connection its statements would join that transaction and be undone
   * with it; on PostgreSQL and MySQL they would commit on a connection of
   * their own. Refused on every dialect, so code that passes on one does not
   * behave differently on another.
   *
   * @throws {DatabaseError} code `NEXTLY_SESSION_INSIDE_TRANSACTION`
   */
  protected refuseSessionInTransaction(): void {
    if (!this.transactionOpenInFlow()) return;
    throw createDatabaseError({
      kind: "query",
      code: "NEXTLY_SESSION_INSIDE_TRANSACTION",
      message:
        "withSession was called inside an open transaction. Its statements run outside any transaction: call it before opening the transaction, or after it has finished.",
    });
  }

  /**
   * Runs `work` with statements that commit one by one, outside any
   * transaction, on one connection held for the whole of `work`.
   *
   * @remarks
   * A unit that must not run in a transaction, such as PostgreSQL's
   * `CREATE INDEX CONCURRENTLY`, still needs what a session gives its
   * statements: one connection is what lets a session setting, or a
   * temporary table, reach every statement. This base runs each statement
   * through `executeQuery`, which is one connection only on an adapter that
   * has one. A pooled adapter overrides it to hold one connection for the
   * whole of `work` and close it afterwards, whether `work` finished or
   * threw, so nothing the session set reaches a later caller; SQLite's
   * override waits until no other flow's transaction is open on its one
   * connection.
   *
   * Refused inside an open transaction (`refuseSessionInTransaction`).
   *
   * @param work - Runs the statements through the session it is handed
   * @param options - Session options
   * @returns Result of `work`
   * @throws {DatabaseError} code `NEXTLY_SESSION_INSIDE_TRANSACTION` when the
   *   calling flow is inside an open transaction
   */
  async withSession<T>(
    work: (session: StatementSession) => Promise<T>,
    _options?: SessionOptions
  ): Promise<T> {
    this.refuseSessionInTransaction();
    return work({
      execute: <R = unknown>(statement: string, params?: SqlParam[]) =>
        this.executeQuery<R>(statement, params),
    });
  }

  /**
   * Whether a `transaction()` call made from the current async context would
   * join a transaction already open on this adapter, as a savepoint, rather
   * than open one of its own.
   *
   * A caller about to do something no rollback can undo — removing a stored
   * file, say — asks this first: work that joins an enclosing transaction is
   * undone with it, while the effect it performs after its own savepoint
   * releases is not.
   *
   * Read from the calling flow's transaction frame ({@link joinableFrame}),
   * alike on every dialect: a call made inside another transaction's work
   * joins it, on its connection.
   *
   * @returns True when the call would nest in an open transaction
   */
  inTransaction(): boolean {
    return this.joinableFrame() !== undefined;
  }

  /**
   * The transaction frame each async flow is inside, kept per flow rather
   * than per connection: on SQLite every request shares the one connection,
   * and another request's open transaction says nothing about this one.
   */
  private readonly scope = new AsyncLocalStorage<TransactionFrame>();

  /** Each pool's reporting views, by method list (`observedPool`). Gone with the pool. */
  private readonly observedPools = new WeakMap<object, Map<string, object>>();

  /**
   * Whether the calling async flow is inside a transaction on this adapter
   * that has not finished: its own, or one it was started from inside.
   *
   * A write that must outlive any rollback — a count of a failed attempt, the
   * spend of a single-use secret — asks this before running in a transaction
   * of its own. Made inside an open transaction on SQLite, it joins that
   * transaction as a savepoint and is undone with it. On PostgreSQL and MySQL
   * it would commit on a connection of its own, so refusing it there too
   * keeps code that passes on one dialect from failing on another. Unlike
   * {@link inTransaction}, which asks whether a call would nest and is always
   * false on a pooled adapter, this answers alike on every dialect, and
   * another flow's open transaction never answers true.
   *
   * Covers transactions opened through {@link transaction} and through the
   * Drizzle handle's own `transaction` on the dialects whose handle takes
   * async work. A flow started inside a transaction, even inside a savepoint
   * that has since released, stays inside it until its outermost transaction
   * has committed or rolled back. An adapter that records no frames answers
   * false.
   *
   * @experimental
   * @returns True while a transaction the calling flow is inside is open
   */
  transactionOpenInFlow(): boolean {
    return (
      transactionAround(this.scope.getStore(), at => !at.finished) !== undefined
    );
  }

  /**
   * The frame a `transaction()` call made from the current async context
   * would join, or none when it would open a transaction of its own. Asks
   * only: {@link beginTransactionCall} is what a call makes on entry.
   *
   * @returns The frame the call would join
   */
  protected joinableFrame(): JoinableFrame | undefined {
    return joinable(this.scope.getStore());
  }

  /**
   * What a dialect's `transaction()` calls on entry, before it waits for
   * anything: the frame the call joins (see {@link joinableFrame}), or none
   * when it opens an outermost transaction of its own.
   *
   * A call made from a frame that has closed runs somewhere else, so what it
   * writes is no longer that frame's to undo. The call is counted on that
   * frame now, at the call, so an effect its context registers from here on
   * is not dropped for that frame's rollback ({@link holdEffect}).
   *
   * @returns The frame the call joins
   */
  protected beginTransactionCall(): JoinableFrame | undefined {
    const own = this.scope.getStore();
    const frame = joinable(own);
    if (own && frame !== own) own.writesAfterClosing += 1;
    return frame;
  }

  /**
   * The stack that opens a transaction, while a test harness observes
   * escapes; undefined otherwise. A dialect captures it at the top of its
   * `transaction()`, before it awaits anything, so the stack still reaches
   * the code that opened the transaction, and hands it to
   * {@link runOutermost} as `steps.openedAt`.
   *
   * @returns The stack, or undefined when no harness observes escapes
   */
  protected captureOpeningStack(): string | undefined {
    return openingStack();
  }

  /**
   * Run `work` as an outermost transaction: `steps.begin`, the work inside a
   * new frame, then `steps.commit`, or `steps.rollback` when any of them
   * throws, or when a part joined to it doomed it (`TransactionSteps.dooms`).
   *
   * Work the transaction started and did not wait for is part of it: joined
   * calls still queued finish before the COMMIT or the ROLLBACK
   * (`settleNested`), so a rollback discards their writes rather than leaving
   * them to run afterwards outside any transaction.
   *
   * Never rejects for the transaction's own failure: it settles with how the
   * transaction ended ({@link Settled}). {@link runOutermost} is the same,
   * resolving once committed and rejecting otherwise. Committed, it hands back the work's
   * result and the `afterCommit` effects held for it, less those a
   * rolled-back part dropped. Rolled back, it hands back the error, as it was
   * thrown, and the `afterRollback` effects. The caller frees the connection
   * and then runs them ({@link runHeldEffects}), so an effect that opens a
   * transaction of its own does not wait behind this one; a caller about to
   * retry drops the rollback effects instead, since the attempt they belong
   * to is not the last. Rollback effects are handed back only once the
   * ROLLBACK is confirmed: when it fails too, nobody can say whether the
   * transaction committed, so they are dropped and that is logged
   * ({@link logHeldEffectFailure}). Classifying the error is the dialect's.
   *
   * @param steps - The statements, the context, and how calls inside join
   * @param work - The transaction's work
   * @param options - The options the transaction was opened with
   * @returns How the transaction ended
   */
  protected async settleOutermost<T, C = TransactionContext>(
    steps: OutermostSteps<C>,
    work: (tx: C) => Promise<T>,
    options?: TransactionOptions
  ): Promise<Settled<T>> {
    try {
      const begun = steps.begin();
      if (isPending(begun)) await begun;
    } catch (error) {
      // No frame was opened, so no effect was held for it.
      await this.rollBackQuietly(steps);
      return { committed: false, error, effects: [] };
    }
    // Opened only once BEGIN has run, so a failed BEGIN leaves no frame
    // behind for a later call to join.
    const frame = openFrame({
      enclosing: this.scope.getStore(),
      join: steps.join,
      options,
      openedAt: steps.openedAt,
    });
    try {
      const result = await this.scope.run(frame, () => work(steps.context));
      await settleNested(frame);
      // A joined part failed in a way this transaction cannot commit past.
      if (frame.doomed) throw frame.doomed.error;
      const committed = steps.commit();
      if (isPending(committed)) await committed;
      frame.finished = true;
      frame.rollbackHeld.length = 0;
      return {
        committed: true,
        result,
        effects: frame.held.filter(
          held => !undone(held.frame, held.writesBefore)
        ),
      };
    } catch (error) {
      await settleNested(frame);
      // Rolled back, or a COMMIT that failed: the effects held for this
      // transaction describe a change that did not happen.
      frame.rolledBack = true;
      frame.finished = true;
      frame.held.length = 0;
      const confirmed = await this.rollBackQuietly(steps);
      const rollbackEffects = frame.rollbackHeld.splice(0);
      return {
        committed: false,
        error,
        effects: confirmed
          ? rollbackEffects
          : this.dropUnconfirmed(rollbackEffects),
      };
    }
  }

  /**
   * Run `work` as an outermost transaction, as {@link settleOutermost} does,
   * resolving once it has committed and rejecting with the error that ended
   * it, as it was thrown, otherwise.
   *
   * @param steps - The statements, the context, and how calls inside join
   * @param work - The transaction's work
   * @param options - The options the transaction was opened with
   * @returns The result, and the `afterCommit` effects to run once the
   *   connection is free
   */
  protected async runOutermost<T, C = TransactionContext>(
    steps: OutermostSteps<C>,
    work: (tx: C) => Promise<T>,
    options?: TransactionOptions
  ): Promise<Committed<T>> {
    const settled = await this.settleOutermost(steps, work, options);
    if (!settled.committed) throw settled.error;
    return { result: settled.result, effects: settled.effects };
  }

  /**
   * Run a transaction's ROLLBACK, never throwing.
   *
   * @returns Whether the ROLLBACK is confirmed: false when it failed, so the
   *   transaction's outcome is unknown
   */
  private async rollBackQuietly<C>(
    steps: TransactionSteps<C>
  ): Promise<boolean> {
    try {
      const rolledBack = steps.rollback();
      if (isPending(rolledBack)) await rolledBack;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Drop the rollback effects of a transaction whose ROLLBACK could not be
   * confirmed, and say so: it may have committed, and compensation run for a
   * change that stands would be the wrong outcome.
   */
  private dropUnconfirmed(effects: HeldEffect[]): HeldEffect[] {
    if (effects.length > 0) {
      this.logHeldEffectFailure(
        new Error(
          `The transaction's outcome is unknown: its ROLLBACK could not be confirmed, so ${String(effects.length)} effect(s) held for a rollback did not run.`
        )
      );
    }
    return [];
  }

  /**
   * Run `work` as a part joined to `frame`: `begin` (a SAVEPOINT, or nothing
   * on a flat join), the work inside a new frame one deeper, then `commit`,
   * or `rollback` when either throws.
   *
   * Joined calls of one frame run one at a time, in the order they were made:
   * two interleaved savepoints would release or roll back each other. Their
   * steps are built only once the call's turn comes (`stepsAt`, handed the
   * part's depth). A rolled-back part is marked so, which drops every effect
   * registered from it, before or after this point; the error is rethrown as
   * it was thrown. A failure the steps say the transaction cannot commit past
   * (`dooms`) dooms the outermost transaction, and a call joined to a doomed
   * transaction fails at once with the error that doomed it. A joined call
   * keeps the outermost transaction's options: its own are recorded on its
   * frame only.
   *
   * @param frame - The frame the call joins, from {@link beginTransactionCall}
   * @param stepsAt - Builds the part's steps for its depth
   * @param work - The part's work
   * @param options - The options the part was opened with
   * @returns What `work` resolves to
   */
  protected runJoined<T, C = TransactionContext>(
    frame: JoinableFrame,
    stepsAt: (depth: number) => TransactionSteps<C>,
    work: (tx: C) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T> {
    return enqueueIn(frame, async () => {
      const root = outermost(frame);
      if (root.doomed) throw root.doomed.error;
      const steps = stepsAt(frame.depth + 1);
      const begun = steps.begin();
      if (isPending(begun)) await begun;
      // Opened only once the savepoint exists, so a failed SAVEPOINT leaves
      // no frame behind for a later call to join.
      const part = openFrame({ parent: frame, join: frame.join, options });
      try {
        const result = await this.scope.run(part, () => work(steps.context));
        await settleNested(part);
        const released = steps.commit();
        if (isPending(released)) await released;
        return result;
      } catch (error) {
        // Joined work this part started and did not wait for is part of it:
        // let it finish first, so the rollback discards its writes rather
        // than leaving it to run afterwards on the enclosing transaction.
        await settleNested(part);
        // Its change is undone, so nothing registered from it, before or
        // after this point, may announce it.
        part.rolledBack = true;
        if (root.doomed === undefined && steps.dooms?.(error) === true) {
          root.doomed = { error };
        }
        await this.rollBackQuietly(steps);
        throw error;
      }
    });
  }

  /**
   * A dialect's `transaction()`: join the transaction the calling flow is
   * inside, or run an outermost one, attempt by attempt.
   *
   * A joined call runs as a part of the open transaction, through the steps
   * its frame offers ({@link runJoined}). An outermost one runs
   * `attempts.run` until an attempt commits, or until one fails that is not
   * tried again. An attempt is tried again, within `retryCount`, when
   * `retryWhen` accepts its error, which is asked first and of every error,
   * application ones included; otherwise when the dialect retries it of its
   * own accord, which it never does for an application error. A committed
   * attempt's effects run once its connection is back; a failed attempt that
   * is retried drops its rollback effects, and the last one runs them.
   *
   * Whatever ends the transaction reaches the caller as it was thrown when it
   * carries the application brand: the application refusing the write, whose
   * code and payload must arrive intact. Every other error is classified.
   *
   * @param work - The transaction's work
   * @param options - The options it was opened with
   * @param attempts - How the dialect runs one attempt, and what it retries
   * @returns What `work` resolves to, once it has committed
   */
  protected async openOrJoin<T>(
    work: (tx: TransactionContext) => Promise<T>,
    options: TransactionOptions | undefined,
    attempts: TransactionAttempts<T>
  ): Promise<T> {
    const frame = this.beginTransactionCall();
    if (frame) {
      try {
        return await this.runJoined(
          frame,
          depth => frame.join.adapter(depth),
          work,
          options
        );
      } catch (error) {
        throw this.transactionError(error);
      }
    }
    // Before anything is awaited, so the stack still reaches the caller.
    const openedAt = this.captureOpeningStack();
    const maxAttempts = (options?.retryCount ?? 0) + 1;
    const retryDelayMs = options?.retryDelayMs ?? 100;
    for (let attempt = 1; ; attempt++) {
      const startTime = Date.now();
      const settled = await attempts.run(attempt, openedAt);
      if (settled.committed) {
        attempts.logger?.debug?.("Transaction committed", {
          attempt,
          durationMs: Date.now() - startTime,
        });
        await this.runHeldEffects(settled.effects);
        return settled.result;
      }
      const { error } = settled;
      let retried: boolean;
      try {
        retried =
          options?.retryWhen?.(error) === true ||
          (!isApplicationError(error) && attempts.retryable(error));
      } catch (thrown) {
        // The attempt did roll back, whatever the question about retrying
        // it raised: its rollback effects still run before that propagates.
        await this.runHeldEffects(settled.effects);
        throw thrown;
      }
      if (attempt < maxAttempts && retried) {
        const { label, detail } = attempts.describe(error);
        attempts.logger?.warn?.(
          `Transaction failed with ${label}, retrying (${attempt}/${maxAttempts})`,
          { ...detail, attempt }
        );
        // This attempt's rollback effects go with it: it is not the last.
        await wait(retryDelayMs * attempt); // Exponential backoff
        continue;
      }
      await this.runHeldEffects(settled.effects);
      throw this.transactionError(error);
    }
  }

  /**
   * An error a transaction ended with, as its caller receives it: one that
   * carries the application brand as it was thrown, any other classified.
   */
  private transactionError(error: unknown): unknown {
    return isApplicationError(error) ? error : this.classifyError(error);
  }

  /**
   * How calls made inside a transaction join it, built by a dialect over the
   * transaction's own connection: a part each, its steps from `part`, handed
   * a transaction context (`context`) or a Drizzle handle on the same
   * connection (`drizzleOn`, with the calling handle's relations, memoized
   * per transaction as a transaction context's handles are).
   *
   * @param context - A transaction context on the connection
   * @param drizzleOn - A Drizzle handle on the connection, with `relations`
   * @param part - The steps of a part joined `depth` deep, handed `context`
   * @returns The join steps, for `OutermostSteps.join`
   */
  protected joinStepsOn<B extends DrizzleTransactor>(
    context: () => TransactionContext,
    drizzleOn: (relations?: AnyRelations) => B,
    part: <C>(context: C, depth: number) => TransactionSteps<C>
  ): JoinSteps {
    const handles = this.transactionDrizzleHandles(drizzleOn);
    return {
      adapter: depth => part(context(), depth),
      drizzle: (depth, relations) =>
        part<DrizzleTransactor>(
          relations ? handles.withRelations<B>(relations) : handles.bare(),
          depth
        ),
    };
  }

  /**
   * A pool-bound Drizzle handle whose transactions are this adapter's: each
   * outermost one on a connection `checkout` hands it
   * ({@link pinDrizzleTransactions}), each one made inside an open
   * transaction joining it ({@link trackFlowTransactions}).
   *
   * @param db - A Drizzle handle on this adapter's pool
   * @param checkout - Checks out a connection for one transaction, with how
   *   calls made inside it join it
   * @param relations - The relations the handle was built with, if any
   * @returns The same handle, its `transaction` replaced
   */
  protected joiningHandle<D extends DrizzleTransactor>(
    db: D,
    checkout: () => Promise<PinnedConnection & { join: JoinSteps }>,
    relations?: AnyRelations
  ): D {
    return this.trackFlowTransactions(
      this.pinDrizzleTransactions(db, checkout, relations),
      relations
    );
  }

  /**
   * Hold `effect` until the transaction enclosing this async context
   * commits, or run it now when none does.
   *
   * The effect belongs to the frame this async context runs in, even one
   * that has already released or rolled back: a service whose own
   * transaction joined as a savepoint registers from its caller's frame once
   * that savepoint has released, and the change is undoable for as long as
   * any frame around it is. The outermost transaction hands the effect back
   * once its COMMIT succeeds ({@link runOutermost}), unless a frame between
   * the effect's frame and the outermost transaction rolled back, and drops
   * every effect on ROLLBACK or a failed COMMIT. A context whose outermost
   * transaction has already finished is outside any transaction, so its
   * effect runs now, unless what it announces was undone and it has run no
   * transaction since.
   *
   * @param effect - What to run once the change is durable
   * @param onDeferredFailure - Receives the error of a held effect that fails
   * @returns Settles once `effect` has run, or once it has been held
   */
  protected async holdEffect(
    effect: () => unknown,
    onDeferredFailure?: (error: unknown) => void
  ): Promise<void> {
    const frame = this.scope.getStore();
    if (!frame) {
      await effect();
      return;
    }
    const root = outermost(frame);
    if (!root.finished) {
      root.held.push({
        effect: this.inRegisteringContext(effect),
        onDeferredFailure,
        frame,
        writesBefore: frame.writesAfterClosing,
      });
      return;
    }
    if (!undone(frame, frame.writesAfterClosing)) await effect();
  }

  /**
   * `effect`, bound to the async context it is registered from.
   *
   * A held effect runs after the outermost COMMIT, from the code that ran the
   * outermost transaction, so without this it sees that code's context rather
   * than its own: whatever its caller pinned around the write is gone. That
   * includes who is calling. A scope pinned for a scoped API key lost there
   * leaves a hook's nested call judged by the key's owner instead of the key,
   * and a person's frame lost there leaves the hook told of nobody.
   *
   * The adapter's own transaction frame is the one store it leaves: the
   * effect runs once that transaction has finished, outside it, as an effect
   * held to the outermost commit always has.
   */
  private inRegisteringContext(effect: () => unknown): () => unknown {
    return AsyncResource.bind(() => this.scope.exit(effect));
  }

  /**
   * Run the effects a committed transaction held, in order. A failure is
   * reported, never thrown: the change is durable, and reporting the
   * transaction as failed would invite a retry of something already done.
   *
   * @param effects - What {@link runOutermost} handed back
   * @returns Settles once every effect has run
   */
  protected async runHeldEffects(effects: HeldEffect[]): Promise<void> {
    for (const { effect, onDeferredFailure } of effects) {
      try {
        await effect();
      } catch (error) {
        this.reportHeldEffectFailure(error, onDeferredFailure);
      }
    }
  }

  /** Hand a held effect's failure to its reporter, or to the adapter's log. */
  private reportHeldEffectFailure(
    error: unknown,
    onDeferredFailure: ((error: unknown) => void) | undefined
  ): void {
    try {
      if (onDeferredFailure) {
        onDeferredFailure(error);
        return;
      }
    } catch {
      // A reporter that throws is reported on below, like no reporter at all.
    }
    this.logHeldEffectFailure(
      error instanceof Error ? error : new Error(String(error))
    );
  }

  /**
   * Log a held effect's failure that no reporter took. A dialect with a
   * logger of its own overrides this.
   *
   * @param failure - The effect's error
   */
  protected logHeldEffectFailure(failure: Error): void {
    console.error("An effect held until commit failed:", failure);
  }

  /**
   * Run a whole transaction, from its BEGIN until its COMMIT or ROLLBACK has
   * run, as the calling flow's open transaction, for
   * {@link transactionOpenInFlow}.
   *
   * The transaction counts as open for its work and for anything the work
   * starts, awaited or not, until it has finished. Something the work starts
   * that outlives it then sees it closed, or the one enclosing it still open.
   * Calls made inside it do not join it: nothing tells them how.
   *
   * @deprecated The adapters in this repository open their transactions with
   *   {@link runOutermost}, whose frames calls made inside can join. Kept for
   *   an adapter that runs its own transactions and only wants them tracked.
   * @param run - The transaction, BEGIN to COMMIT or ROLLBACK
   * @returns What `run` resolves to
   */
  protected runInFlowTransaction<T>(run: () => Promise<T>): Promise<T> {
    const frame = openFrame({
      enclosing: this.scope.getStore(),
      join: undefined,
      openedAt: openingStack(),
    });
    // It holds no connection of its own until the dialect says so
    // (`markFlowTransactionConnected`).
    frame.connected = false;
    return this.scope.run(frame, async () => {
      try {
        return await run();
      } finally {
        frame.finished = true;
        closeFrame(frame);
      }
    });
  }

  /**
   * Record that the calling flow's transaction now holds its own connection,
   * so {@link notePoolAccess} can tell that checkout, which belongs to the
   * transaction, from any later one, which escapes it.
   *
   * @deprecated For a transaction tracked with {@link runInFlowTransaction};
   *   a frame {@link runOutermost} opens holds its connection from the start.
   */
  protected markFlowTransactionConnected(): void {
    const frame = this.scope.getStore();
    if (frame !== undefined) outermost(frame).connected = true;
  }

  /**
   * Check out, through `checkout`, the connection the calling flow's
   * transaction runs on: the checkout is reported first
   * ({@link notePoolAccess}), and once it holds its own, the transaction is
   * marked connected, so its later checkouts are told apart from it.
   *
   * @deprecated For a transaction tracked with {@link runInFlowTransaction};
   *   a dialect that opens its frames with {@link runOutermost} reports its
   *   checkout with {@link notePoolAccess} and hands the connection over.
   * @param checkout - Takes a connection from the dialect's pool
   * @returns The connection
   */
  protected async connectFlowTransaction<C>(
    checkout: () => Promise<C>
  ): Promise<C> {
    this.notePoolAccess();
    const connection = await checkout();
    this.markFlowTransactionConnected();
    return connection;
  }

  /**
   * Called by a pooled dialect before it takes anything from its pool: a
   * query, or a connection checkout.
   *
   * While the calling flow is inside a transaction that already holds its own
   * connection, a pool access runs on another connection: outside the
   * transaction, blind to its uncommitted writes, not undone by its rollback,
   * and able to stall a small pool. Such an access is reported to the
   * observer a test harness installs under
   * `Symbol.for("nextly.transactionEscapeObserver")`, with the stack that
   * names its call site. With no observer installed, which is every
   * production process, this is one property read.
   *
   * @param statement - What the pool call was handed, its SQL passed on so
   *   the harness can say which statement escaped; nothing for a checkout
   */
  protected notePoolAccess(statement?: unknown): void {
    const observe = escapeObserver();
    if (observe === undefined) return;
    const escaped = transactionAround(
      this.scope.getStore(),
      at => !at.finished && at.connected
    );
    if (escaped === undefined) return;
    observe({
      dialect: this.dialect,
      stack: deepStack(),
      openedAt: escaped.openedAt,
      statement: statementOf(statement),
    });
  }

  /**
   * `pool`, with {@link notePoolAccess} called before each of `methods`, for
   * handing to code that queries the pool directly, such as Drizzle's handle.
   * Everything else, `instanceof` included, reaches the pool unchanged.
   *
   * One view per pool and method list, made once: every Drizzle handle on the pool is given the
   * same one, so `getDrizzle()` and `getDrizzle(relations)` share a `$client`, as they did when
   * each was handed the pool itself.
   *
   * @param pool - The driver's pool
   * @param methods - The pool methods that take a connection
   * @returns A view of `pool` that reports those calls
   */
  protected observedPool<P extends object>(
    pool: P,
    methods: readonly string[]
  ): P {
    const key = methods.join(",");
    const views = this.observedPools.get(pool) ?? new Map<string, object>();
    this.observedPools.set(pool, views);
    const cached = views.get(key);
    if (cached) return cached as P;
    const view = new Proxy(pool, {
      get: (target, property, receiver) => {
        const value: unknown = Reflect.get(target, property, receiver);
        if (
          typeof property !== "string" ||
          !methods.includes(property) ||
          typeof value !== "function"
        ) {
          return value;
        }
        return (...args: unknown[]) => {
          this.notePoolAccess(args[0]);
          return Reflect.apply(value, target, args);
        };
      },
    });
    views.set(key, view);
    return view;
  }

  /**
   * Run each of a pool-bound Drizzle handle's outermost transactions on a
   * connection `checkout` hands it, as an outermost transaction of this
   * adapter: inside a frame that later calls join, its `afterCommit` effects
   * held until it commits and run once the connection is back.
   *
   * The connection goes back as the adapter's own `transaction()` returns
   * its own: closed rather than pooled when no ROLLBACK can be confirmed on
   * it, and never leaked by a failed BEGIN (`pinTransactions`). Drizzle runs
   * BEGIN and COMMIT on it; the work it hands Drizzle waits for the calls
   * joined to the transaction, and fails when one of them doomed it, before
   * Drizzle's COMMIT. Drizzle's own `tx.transaction` joins this adapter's
   * transaction rather than opening a SAVEPOINT of Drizzle's
   * ({@link trackFlowTransactions}).
   *
   * For PostgreSQL's and MySQL's handles. Apply it before
   * {@link trackFlowTransactions}, which wraps whatever `transaction` the
   * handle has at that point.
   *
   * @param db - A Drizzle handle on this adapter's pool
   * @param checkout - Checks out a connection for one transaction, with how
   *   calls made inside it join it
   * @param relations - The relations the handle was built with, if any
   * @returns The same handle, its `transaction` replaced
   */
  protected pinDrizzleTransactions<D extends DrizzleTransactor>(
    db: D,
    checkout: () => Promise<PinnedConnection & { join: JoinSteps }>,
    relations?: AnyRelations
  ): D {
    return pinTransactions(db, async () => {
      // Before anything is awaited, so the stack still reaches the caller.
      const openedAt = openingStack();
      // A checkout, taken from the pool like a query is.
      this.notePoolAccess();
      const connection = await checkout();
      let effects: HeldEffect[] = [];
      // Whether those are a rollback's, run only once its ROLLBACK is confirmed.
      let rolledBack = false;
      const framed: DrizzleTransactor = {
        transaction: async (work, config) => {
          const settled = await this.settleOutermost(
            {
              context: undefined,
              join: connection.join,
              openedAt,
              // Drizzle sends BEGIN, COMMIT and ROLLBACK itself, and
              // `pinTransactions` confirms the ROLLBACK.
              begin() {},
              commit() {},
              rollback() {},
            },
            () =>
              connection.drizzle.transaction(async tx => {
                const result = await work(this.joining(tx, relations));
                const frame = this.scope.getStore();
                if (frame !== undefined) {
                  await settleNested(frame);
                  if (frame.doomed) throw frame.doomed.error;
                }
                return result;
              }, config)
          );
          effects = settled.effects;
          rolledBack = !settled.committed;
          if (settled.committed) return settled.result;
          throw settled.error;
        },
      };
      return {
        drizzle: framed,
        rollback: () => connection.rollback(),
        release: dirty => connection.release(dirty),
        // `dirty`: no ROLLBACK could be confirmed on the connection.
        afterRelease: dirty =>
          this.runHeldEffects(
            dirty && rolledBack ? this.dropUnconfirmed(effects) : effects
          ),
      };
    });
  }

  /**
   * Make a Drizzle handle's own `transaction` join a transaction the calling
   * flow is inside, as the adapter's `transaction()` does, and open one of
   * this adapter's otherwise.
   *
   * Core's services run their transactions through the handle on PostgreSQL
   * and MySQL. A call joined to an open transaction runs its work on that
   * transaction's connection, through a Drizzle handle bound to it
   * (`JoinSteps.drizzle`), whose own `transaction` joins in turn. A plain
   * Drizzle handle on that connection would send BEGIN and COMMIT, which
   * would commit the transaction it was meant to join. Not for SQLite's
   * handle: its `transaction` takes only synchronous work, which no async
   * flow can be inside.
   *
   * @param db - A Drizzle handle this adapter created
   * @param relations - The relations the handle was built with, if any
   * @returns The same handle, its `transaction` joining
   */
  protected trackFlowTransactions<D extends DrizzleTransactor>(
    db: D,
    relations?: AnyRelations
  ): D {
    const transactor: DrizzleTransactor = db;
    const own = transactor.transaction.bind(transactor);
    Object.defineProperty(db, "transaction", {
      value: this.joiningTransaction(own, relations),
      configurable: true,
      writable: true,
    });
    return db;
  }

  /**
   * A Drizzle `transaction` that joins the transaction the calling flow is
   * inside, and falls back to `own` when there is none.
   */
  private joiningTransaction(
    own: DrizzleTransactor["transaction"],
    relations: AnyRelations | undefined
  ): DrizzleTransactor["transaction"] {
    return (work, config) => {
      const frame = this.beginTransactionCall();
      const joinDrizzle = frame?.join.drizzle;
      if (frame === undefined || joinDrizzle === undefined) {
        return own(work, config);
      }
      return this.runJoined(
        frame,
        depth => {
          const steps = joinDrizzle(depth, relations);
          return { ...steps, context: this.joining(steps.context, relations) };
        },
        work
      );
    };
  }

  /**
   * `tx`, a Drizzle transaction handle, its own `transaction` joining this
   * adapter's transaction rather than opening a savepoint of Drizzle's: a
   * part joined that way holds its effects, dooms the transaction where its
   * dialect's join is flat, and is told apart by what joins it later.
   */
  private joining<X>(tx: X, relations: AnyRelations | undefined): X {
    if (typeof tx !== "object" || tx === null) return tx;
    const own: unknown = Reflect.get(tx, "transaction");
    if (typeof own !== "function") return tx;
    const drizzleOwn: DrizzleTransactor["transaction"] = (work, config) =>
      Reflect.apply(own, tx, [work, config]);
    Object.defineProperty(tx, "transaction", {
      value: this.joiningTransaction(drizzleOwn, relations),
      configurable: true,
      writable: true,
    });
    return tx;
  }

  /**
   * Run `effect` once the write made from the current async context has
   * committed: an event, a hook, a cache flush, anything outside the database
   * that must not happen for a change that is rolled back.
   *
   * A caller invokes this after its own transaction has resolved. Where that
   * transaction was nested in an enclosing one, as a savepoint, the change is
   * not durable yet, and an adapter that nests (see {@link inTransaction})
   * holds `effect` ({@link holdEffect}) until the outermost transaction
   * commits, and drops it when
   * that transaction, or the savepoint it was registered in, rolls back. A
   * held effect runs after the commit, before the outermost `transaction()`
   * call resolves, in registration order; one that then throws or rejects is
   * handed to `onDeferredFailure` rather than failing a transaction that has
   * committed.
   *
   * Outside any transaction `effect` runs now, and the returned promise
   * settles with it, its failure included. On every dialect a held effect
   * runs once the outermost transaction has committed and its connection is
   * back, so one that opens a transaction of its own does not wait behind it.
   *
   * @experimental
   * @param effect - What to run once the change is durable
   * @param onDeferredFailure - Receives the error of a held effect that fails
   * @returns Settles once `effect` has run, or once it has been held
   */
  afterCommit(
    effect: () => unknown,
    onDeferredFailure?: (error: unknown) => void
  ): Promise<void> {
    return this.holdEffect(effect, onDeferredFailure);
  }

  /**
   * Run `effect` once the transaction enclosing this async context has
   * rolled back for good: compensation for something outside the database
   * that was started on the change's behalf.
   *
   * Held from any frame of the transaction until its outermost transaction
   * ends. When that one commits, every rollback effect is dropped, a
   * rolled-back savepoint's included: the outcome that stands is a commit.
   * When an attempt rolls back and is retried (`TransactionOptions.retryCount`,
   * `retryWhen`), its effects are dropped with it, so they run once, after the
   * last attempt has rolled back, once its connection is back, in
   * registration order; one that then fails is handed to `onDeferredFailure`.
   *
   * Outside any open transaction there is nothing left to roll back: `effect`
   * runs now when the transaction this context ran in rolled back, and is
   * dropped otherwise.
   *
   * @experimental
   * @param effect - What to run once the change has rolled back
   * @param onDeferredFailure - Receives the error of a held effect that fails
   * @returns Settles once `effect` has run, been held, or been dropped
   */
  async afterRollback(
    effect: () => unknown,
    onDeferredFailure?: (error: unknown) => void
  ): Promise<void> {
    const frame = this.scope.getStore();
    if (!frame) return;
    const root = outermost(frame);
    if (!root.finished) {
      root.rollbackHeld.push({
        effect: this.inRegisteringContext(effect),
        onDeferredFailure,
        frame,
        writesBefore: frame.writesAfterClosing,
      });
      return;
    }
    if (undone(frame, frame.writesAfterClosing)) await effect();
  }

  /**
   * Get database capabilities.
   *
   * @remarks
   * Returns static capability flags for this adapter's dialect.
   * Used by services to conditionally enable features or implement fallbacks.
   *
   * @returns Database capability flags
   */
  abstract getCapabilities(): DatabaseCapabilities;

  /**
   * The schema this adapter's connections resolve unqualified names in.
   *
   * @remarks
   * Read-only, and optional because only PostgreSQL has a schema namespace:
   * MySQL's "schema" is its database and SQLite has one file. An adapter that
   * sets no `search_path` of its own answers `undefined`, meaning the server's
   * default applies.
   *
   * Exposed so the caller that built its own adapter can be held to the same
   * schema the rest of the application assumes. The value lives in the
   * adapter's config, and a mismatch is not an error anywhere below: every
   * query succeeds, in a namespace nothing else is looking at.
   *
   * @returns The configured schema name, or `undefined` when none is set
   */
  getConfiguredSchema?(): string | undefined;

  /**
   * Get the raw Drizzle ORM instance for direct queries.
   *
   * @remarks
   * This method provides escape hatch access to the raw Drizzle instance.
   * Use this when you need to run complex queries that the adapter API
   * doesn't support, or for legacy code migration.
   *
   * **Note:** Prefer using adapter methods when possible as they provide:
   * - Database-agnostic API
   * - Consistent error handling
   * - Proper connection pooling
   *
   * @param relations - Optional drizzle v1 relations config (defineRelations
   *   output) that enables the typed relational query API on the instance
   * @returns Raw Drizzle ORM database instance
   *
   * @example
   * ```typescript
   * // For legacy code that needs direct Drizzle access
   * const db = adapter.getDrizzle(myRelations); // defineRelations output
   * const result = await db.insert(users).values({ ... }).returning();
   * ```
   */
  abstract getDrizzle<T = unknown>(relations?: AnyRelations): T;

  // ============================================================
  // Drizzle Query API Support
  // ============================================================

  /**
   * Table resolver for looking up Drizzle table objects by name.
   * When set, CRUD methods use Drizzle's query API instead of raw SQL.
   * Set via setTableResolver() after boot-time schema loading.
   */
  protected tableResolver: TableResolver | null = null;

  /**
   * Set the table resolver for Drizzle query API support.
   * When a resolver is set, CRUD methods (select, insert, update, delete, upsert)
   * will use Drizzle's query API (db.select().from(), etc.) instead of raw SQL
   * string building. A table the resolver does not hold is refused with
   * `TABLE_NOT_REGISTERED_CODE` (`tableNotRegisteredError`).
   *
   * @param resolver - TableResolver implementation (e.g. SchemaRegistry)
   */
  setTableResolver(resolver: TableResolver): void {
    this.tableResolver = resolver;
  }

  /**
   * Get a Drizzle table object by name from the resolver.
   * Returns null if no resolver is set or table is not found.
   */
  protected getTableObject(tableName: string): unknown {
    return this.tableResolver?.getTable(tableName) ?? null;
  }

  /**
   * Run a Drizzle-built statement and return its rows.
   *
   * @remarks
   * The CRUD methods resolve their table through the schema registry and reject
   * any name it does not declare, which leaves no way to read from a table the
   * ORM does not know — one mid-rename, above all — except by assembling SQL and
   * quoting identifiers by hand. This takes Drizzle's `sql` template instead, so
   * the dialect in use decides the quoting and the parameter binding.
   *
   * Concrete rather than abstract so existing adapters keep working unchanged.
   * The three drivers disagree about both the call and the result: node-postgres
   * returns `{ rows }`, mysql2 a `[rows, fields]` tuple, and better-sqlite3 has
   * no `execute` at all and answers `all`. Keeping that here rather than at each
   * call site is the point — a caller reasoning about it would be reasoning
   * about a driver it cannot see.
   *
   * @param statement - Drizzle `sql` template to run
   * @returns Rows the statement produced
   */
  async queryStatement<T = Record<string, unknown>>(
    statement: SQL
  ): Promise<T[]> {
    if (this.getCapabilities().dialect === "sqlite") {
      const db = this.getDrizzle<{ all(query: SQL): T[] | Promise<T[]> }>();
      return await db.all(statement);
    }
    const db = this.getDrizzle<{ execute(query: SQL): Promise<unknown> }>();
    const result = await db.execute(statement);
    // `{ rows }` is node-postgres. A bare array is mysql2's `[rows, fields]`
    // tuple, told apart by its first element being an array — the only test that
    // does not depend on trusting one driver to keep its shape.
    if (Array.isArray(result)) {
      return (Array.isArray(result[0]) ? result[0] : result) as T[];
    }
    if (
      typeof result === "object" &&
      result !== null &&
      Array.isArray((result as { rows?: unknown }).rows)
    ) {
      return (result as { rows: T[] }).rows;
    }
    // Refused rather than reported as no rows. All three drivers answer one of
    // the shapes above, so anything else means the result was not understood —
    // and "I could not read this" must not reach a caller as "there is nothing
    // there", which is an answer it would act on.
    throw this.createDatabaseError(
      "query",
      "Drizzle statement returned a result shape this adapter does not recognise; refusing to report it as an empty result.",
      undefined
    );
  }

  /**
   * Map data keys from SQL column names (snake_case) to Drizzle JS property names (camelCase).
   * Drizzle schemas define columns as e.g. `createdAt: timestamp("created_at")` — the JS
   * property is `createdAt` but the SQL column is `created_at`. Services pass snake_case keys
   * because they match the DB column names. This method maps them to the JS names Drizzle expects.
   */
  protected mapDataToColumnNames(
    tableObj: unknown,
    data: Record<string, unknown>
  ): Record<string, unknown> {
    if (!tableObj || typeof tableObj !== "object") return data;

    // Build maps: SQL column name -> JS property name, and JS name -> column metadata
    const sqlToJs = new Map<string, string>();
    const jsonColumns = new Set<string>();

    for (const [jsName, colDef] of Object.entries(
      tableObj as Record<string, unknown>
    )) {
      if (
        !colDef ||
        typeof colDef !== "object" ||
        !("name" in colDef) ||
        typeof colDef.name !== "string"
      )
        continue;
      const sqlName = (colDef as { name: string }).name;
      sqlToJs.set(sqlName, jsName);

      // Drizzle serializes objects for a JSON column itself, so a value that
      // arrives already serialized is parsed first or it is serialized twice.
      // One predicate with the transactional path, so the two cannot drift.
      if (isJsonColumn(colDef as ColumnKindInput)) {
        jsonColumns.add(jsName);
      }
    }

    // If no mappings found, return data as-is
    if (sqlToJs.size === 0) return data;

    const mapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const jsKey = sqlToJs.get(key) ?? key;
      // Parse pre-stringified JSON for JSON/JSONB columns to avoid double-encoding
      if (jsonColumns.has(jsKey) && typeof value === "string") {
        try {
          mapped[jsKey] = JSON.parse(value);
        } catch {
          mapped[jsKey] = value;
        }
      } else {
        mapped[jsKey] = value;
      }
    }
    return mapped;
  }

  /**
   * Map data keys from Drizzle JS property names to SQL column names for the
   * raw-SQL transaction insert path. The transaction context builds INSERT
   * statements from Object.keys(data) used directly as column identifiers, so a
   * table whose Drizzle property names differ from its SQL column names
   * (camelCase core tables like nextly_versions) needs its keys translated
   * first. For tables whose property names already equal their column names
   * (the dynamic dc_/single_/comp_ tables) every lookup is identity, so
   * existing callers are unaffected.
   */
  protected mapKeysToSqlColumns(
    tableObj: unknown,
    data: Record<string, unknown>
  ): Record<string, unknown> {
    if (!tableObj || typeof tableObj !== "object") return data;

    const jsToSql = new Map<string, string>();
    for (const [jsName, colDef] of Object.entries(
      tableObj as Record<string, unknown>
    )) {
      if (
        colDef &&
        typeof colDef === "object" &&
        "name" in colDef &&
        typeof (colDef as { name?: unknown }).name === "string"
      ) {
        jsToSql.set(jsName, (colDef as { name: string }).name);
      }
    }
    if (jsToSql.size === 0) return data;

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      out[jsToSql.get(key) ?? key] = value;
    }
    return out;
  }

  /**
   * Map a list of column identifiers (Drizzle property names) to their SQL
   * column names, for the raw-SQL transaction insert paths that build a
   * RETURNING clause from `options.returning`. Same identity behavior as
   * `mapKeysToSqlColumns`: names that are already SQL columns (the dynamic
   * dc_/single_/comp_ tables) pass through unchanged.
   */
  protected mapColumnNamesToSql(tableObj: unknown, names: string[]): string[] {
    if (!tableObj || typeof tableObj !== "object") return names;

    const jsToSql = new Map<string, string>();
    for (const [jsName, colDef] of Object.entries(
      tableObj as Record<string, unknown>
    )) {
      if (
        colDef &&
        typeof colDef === "object" &&
        "name" in colDef &&
        typeof (colDef as { name?: unknown }).name === "string"
      ) {
        jsToSql.set(jsName, (colDef as { name: string }).name);
      }
    }
    if (jsToSql.size === 0) return names;

    return names.map(n => jsToSql.get(n) ?? n);
  }

  /**
   * Remap a raw-SQL result row's KEYS from SQL column names to Drizzle property
   * names, so the raw-SQL transaction insert paths return the same key casing
   * as the non-transactional (Drizzle) insert. Keys only - values are left
   * untouched, so this does not change how JSON/date columns are decoded. For
   * tables whose property names already equal their SQL columns (the dynamic
   * dc_/single_/comp_ tables) every lookup is identity, so existing callers see
   * no change.
   */
  protected mapRowKeysToJs<T = unknown>(tableObj: unknown, row: T): T {
    if (
      !tableObj ||
      typeof tableObj !== "object" ||
      !row ||
      typeof row !== "object"
    ) {
      return row;
    }

    const sqlToJs = new Map<string, string>();
    for (const [jsName, colDef] of Object.entries(
      tableObj as Record<string, unknown>
    )) {
      if (
        colDef &&
        typeof colDef === "object" &&
        "name" in colDef &&
        typeof (colDef as { name?: unknown }).name === "string"
      ) {
        sqlToJs.set((colDef as { name: string }).name, jsName);
      }
    }
    if (sqlToJs.size === 0) return row;

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      out[sqlToJs.get(key) ?? key] = value;
    }
    return out as T;
  }

  /**
   * Decode a raw-SQL result row's DATE column values the way a Drizzle query
   * would, so a write answers with the same representation a read of the same
   * column gives.
   *
   * A Drizzle query path runs every value through its column definition; a
   * raw-SQL path does not, so a dialect that stores a timestamp as a number
   * answers a write with that number while every read answers a `Date`. Only
   * date columns are touched, and a value that is already a `Date` is left
   * alone, so a driver that decodes on its own is unaffected.
   *
   * Runs after {@link mapRowKeysToJs}: keys are Drizzle property names by then,
   * which is what the table definition is keyed by.
   */
  protected mapDateValuesFromDriver<T = unknown>(tableObj: unknown, row: T): T {
    if (
      !tableObj ||
      typeof tableObj !== "object" ||
      !row ||
      typeof row !== "object"
    ) {
      return row;
    }

    let decoded: Record<string, unknown> | undefined;
    for (const [jsName, colDef] of Object.entries(
      tableObj as Record<string, unknown>
    )) {
      if (!isDateColumn(colDef)) continue;
      const value = (row as Record<string, unknown>)[jsName];
      // `undefined` means the column was not projected; `null` is a stored
      // absence. Neither is a driver representation to decode.
      if (value == null || value instanceof Date) continue;
      decoded ??= { ...(row as Record<string, unknown>) };
      decoded[jsName] = colDef.mapFromDriverValue(value);
    }
    return (decoded as T | undefined) ?? row;
  }

  /**
   * Encode a row's DATE values the way a Drizzle query would before binding
   * them, so what lands in the column does not depend on the server's timezone.
   *
   * A column declared without a time zone stores a wall clock and records
   * nothing about which zone it belongs to, so both ends have to agree. Drizzle
   * writes UTC and reads UTC. A driver handed a `Date` writes the LOCAL wall
   * clock instead, and the same row then reads back shifted by the offset --
   * on a UTC server the two agree and nothing is visibly wrong, which is why
   * this survives CI.
   *
   * Only date columns are touched. A value that is not a `Date` is left as it
   * is, so a caller that already encoded one is not encoded twice.
   *
   * Keys may be spelled either way at this point, so both the Drizzle property
   * name and the SQL column name resolve.
   */
  protected mapDateValuesToDriver(
    tableObj: unknown,
    data: Record<string, unknown>
  ): Record<string, unknown> {
    if (!tableObj || typeof tableObj !== "object" || !data) return data;

    const dateColumns = new Map<string, DecodableColumn>();
    for (const [jsName, colDef] of Object.entries(
      tableObj as Record<string, unknown>
    )) {
      if (!isDateColumn(colDef)) continue;
      dateColumns.set(jsName, colDef);
      const sqlName = (colDef as { name?: unknown }).name;
      if (typeof sqlName === "string") dateColumns.set(sqlName, colDef);
    }
    if (dateColumns.size === 0) return data;

    let encoded: Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(data)) {
      if (!(value instanceof Date)) continue;
      const column = dateColumns.get(key);
      if (!column) continue;
      encoded ??= { ...data };
      encoded[key] = column.mapToDriverValue(value);
    }
    return encoded ?? data;
  }

  /**
   * Bring a row about to be written through a raw-SQL statement into the shape
   * a Drizzle query would have bound: SQL column names for keys, encoded values
   * for date columns.
   *
   * The mirror of {@link mapRowFromRawSql}. The raw-SQL write paths exist
   * because a dialect needs SQL a Drizzle query cannot express, not because
   * their callers want different values in the table.
   */
  protected mapRowToRawSql(
    tableObj: unknown,
    data: Record<string, unknown>
  ): Record<string, unknown> {
    return this.mapDateValuesToDriver(
      tableObj,
      this.mapKeysToSqlColumns(tableObj, data)
    );
  }

  /**
   * Bring a raw-SQL result row into the shape a Drizzle query would have
   * produced: Drizzle property names for keys, decoded values for date columns.
   *
   * The raw-SQL write paths exist because a dialect needs SQL a Drizzle query
   * cannot express, not because their callers want a different row shape, so
   * every one of them ends here.
   */
  protected mapRowFromRawSql<T = unknown>(
    tableObj: unknown,
    row: T,
    aliases: ReadonlyArray<{ alias: string; jsName: string }> = []
  ): T {
    const mapped = this.mapDateValuesFromDriver(
      tableObj,
      this.mapRowKeysToJs(tableObj, row)
    );
    return this.applyWallClockAliases(mapped, aliases);
  }

  /**
   * The date columns a statement is about to return, and the alias each one's
   * wall clock is spelled out under.
   *
   * A driver turns a timestamp into a `Date` using ITS zone before any of this
   * code runs, and that conversion is lossy: a wall clock inside a
   * daylight-saving gap is a local time that does not exist, so the driver
   * normalizes it and the original is gone. Asking the database for the wall
   * clock as text alongside the row is the only way to read it exactly.
   *
   * `"*"` covers every date column; a projection covers only the ones it asked
   * for, so a caller still gets back what it requested and nothing more.
   */
  protected dateWallClockAliases(
    tableObj: unknown,
    returning: string[] | "*" | undefined
  ): Array<{ sqlName: string; alias: string; jsName: string }> {
    if (!tableObj || typeof tableObj !== "object" || returning === undefined) {
      return [];
    }
    const requested =
      returning === "*" ? undefined : new Set(returning.map(String));

    // Every name the row can already carry, so an alias cannot land on one and
    // overwrite or delete it. A column really called `__nx_wc0` is far-fetched,
    // but one set makes it impossible rather than unlikely.
    const taken = new Set<string>();
    for (const [jsName, colDef] of Object.entries(
      tableObj as Record<string, unknown>
    )) {
      taken.add(jsName);
      const columnName = (colDef as { name?: unknown }).name;
      if (typeof columnName === "string") taken.add(columnName);
    }

    let next = 0;
    const freeAlias = (): string => {
      let candidate = `${WALL_CLOCK_ALIAS_STEM}${next++}`;
      while (taken.has(candidate)) {
        candidate = `${WALL_CLOCK_ALIAS_STEM}${next++}`;
      }
      taken.add(candidate);
      return candidate;
    };

    const aliases: Array<{ sqlName: string; alias: string; jsName: string }> =
      [];
    for (const [jsName, colDef] of Object.entries(
      tableObj as Record<string, unknown>
    )) {
      if (!isDateColumn(colDef)) continue;
      // A column carrying its own zone is already unambiguous; spelling it out
      // would render it in the session's zone and reading that as UTC would
      // move an instant that was correct to begin with.
      if (carriesTimeZone(colDef)) continue;
      const sqlName = (colDef as { name?: unknown }).name;
      if (typeof sqlName !== "string") continue;
      if (requested && !requested.has(sqlName) && !requested.has(jsName)) {
        continue;
      }
      aliases.push({ sqlName, alias: freeAlias(), jsName });
    }
    return aliases;
  }

  /**
   * Replace each date in a row with the wall clock the database spelled out,
   * read as UTC, and drop the aliases that carried it.
   *
   * The statement writes a UTC wall clock, so reading one back as UTC is what
   * makes a write and a later read agree. Whatever the column actually stored
   * is what arrives -- a column keeping only whole seconds reports whole
   * seconds -- because this is the database's own text, not a value
   * reconstructed from the one that was bound.
   */
  protected applyWallClockAliases<T>(
    row: T,
    aliases: ReadonlyArray<{ alias: string; jsName: string }>
  ): T {
    if (!row || typeof row !== "object" || aliases.length === 0) return row;
    const record = row as Record<string, unknown>;

    let resolved: Record<string, unknown> | undefined;
    for (const { alias, jsName } of aliases) {
      if (!(alias in record)) continue;
      resolved ??= { ...record };
      const text = resolved[alias];
      delete resolved[alias];
      if (typeof text !== "string") continue;
      const parsed = parseWallClockAsUtc(text);
      if (parsed !== undefined) resolved[jsName] = parsed;
    }
    return (resolved as T | undefined) ?? row;
  }

  /**
   * Build a Drizzle column projection object (`{ propertyName: column }`) from a
   * requested column list, used by `select` (columns) and `insert` (returning).
   * A requested name resolves against either the Drizzle property name
   * (camelCase) or the SQL column name (snake_case); the projection is keyed by
   * the property name so the row shape matches a full select. Returns undefined
   * for `"*"` or when nothing resolves, so callers fall back to all columns.
   */
  protected buildColumnProjection(
    tableObj: unknown,
    names: string[] | "*" | undefined
  ): Record<string, unknown> | undefined {
    if (
      names == null ||
      names === "*" ||
      !tableObj ||
      typeof tableObj !== "object"
    ) {
      return undefined;
    }
    const { projection } = this.resolveColumns(tableObj, names);
    return Object.keys(projection).length ? projection : undefined;
  }

  /**
   * The requested column names split into what this table has and what it does not.
   *
   * One resolution, reported both ways, because two callers need different halves
   * of the same answer: a projection drops what it cannot find, while a distinct
   * count has to REFUSE it. Resolving twice would let the two disagree about what
   * "found" means — the SQL-name alias below is exactly the kind of detail a
   * second implementation gets wrong — and the count would then reject a column
   * the projection happily uses.
   *
   * Both spellings resolve: a caller may name the Drizzle property or the SQL
   * column, and either maps to the same projection key.
   */
  protected resolveColumns(
    tableObj: unknown,
    names: readonly string[]
  ): { projection: Record<string, unknown>; unresolved: string[] } {
    const cols = getColumns(tableObj as never);
    const byAnyName: Record<string, { jsName: string; col: unknown }> = {};
    for (const [jsName, col] of Object.entries(cols)) {
      byAnyName[jsName] = { jsName, col };
      const sqlName = (col as { name?: unknown })?.name;
      if (typeof sqlName === "string") byAnyName[sqlName] = { jsName, col };
    }
    const projection: Record<string, unknown> = {};
    const unresolved: string[] = [];
    for (const name of names) {
      const hit = byAnyName[name];
      if (hit) projection[hit.jsName] = hit.col;
      else unresolved.push(name);
    }
    return { projection, unresolved };
  }

  // ============================================================
  // Connection Status (Default implementations, can override)
  // ============================================================

  /**
   * Check if the adapter is currently connected.
   *
   * @remarks
   * Default implementation returns false. Subclasses should override
   * to provide accurate connection status.
   *
   * @returns True if connected, false otherwise
   */
  isConnected(): boolean {
    return false;
  }

  /**
   * Get connection pool statistics.
   *
   * @remarks
   * Returns null by default. Subclasses with connection pooling
   * should override to provide pool statistics.
   *
   * @returns Pool statistics or null if not applicable
   */
  getPoolStats(): PoolStats | null {
    return null;
  }

  // ============================================================
  // Timeout Utilities
  // ============================================================

  /**
   * Default query timeout in milliseconds.
   *
   * @remarks
   * This value is used by executeWithTimeout() when no explicit timeout
   * is provided. Subclasses should set this from their config.
   *
   * @default 15000 (15 seconds)
   *
   * @protected
   */
  protected defaultQueryTimeoutMs: number = 15000;

  /**
   * Execute an async operation with a timeout.
   *
   * @remarks
   * Wraps an async operation with a timeout that aborts if the operation
   * exceeds the specified duration. Uses Promise.race for clean timeout
   * handling without memory leaks.
   *
   * When the timeout is reached, a DatabaseError with kind 'timeout' is thrown.
   * Note that this does NOT cancel the underlying database query - it only
   * prevents the calling code from waiting indefinitely. For true query
   * cancellation, use database-level statement timeouts (PostgreSQL) or
   * similar mechanisms.
   *
   * @param operation - Async operation to execute
   * @param timeoutMs - Timeout in milliseconds (defaults to defaultQueryTimeoutMs)
   * @returns Result of the operation
   *
   * @throws {DatabaseError} With kind 'timeout' if operation exceeds timeout
   *
   * @example
   * ```typescript
   * // Use default timeout
   * const result = await adapter.executeWithTimeout(
   *   () => adapter.select('users', { limit: 1000 })
   * );
   *
   * // Use custom timeout for specific operation
   * const result = await adapter.executeWithTimeout(
   *   () => adapter.select('large_table'),
   *   60000 // 60 seconds for large queries
   * );
   * ```
   *
   * @public
   */
  async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs?: number
  ): Promise<T> {
    const timeout = timeoutMs ?? this.defaultQueryTimeoutMs;

    // If timeout is 0 or negative, execute without timeout
    if (timeout <= 0) {
      return operation();
    }

    // Create a timeout promise that rejects after the specified duration
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          this.createDatabaseError(
            "timeout",
            `Query execution timed out after ${timeout}ms`
          )
        );
      }, timeout);
    });

    try {
      // Race between the operation and the timeout
      const result = await Promise.race([operation(), timeoutPromise]);
      return result;
    } finally {
      // Always clear the timeout to prevent memory leaks
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Set the default query timeout.
   *
   * @remarks
   * This method allows runtime configuration of the default timeout.
   * Subclasses should call this in their constructor or connect() method
   * based on their configuration.
   *
   * @param timeoutMs - Timeout in milliseconds (0 to disable)
   *
   * @protected
   */
  protected setDefaultQueryTimeout(timeoutMs: number): void {
    this.defaultQueryTimeoutMs = timeoutMs;
  }

  /**
   * Get the current default query timeout.
   *
   * @returns Current default timeout in milliseconds
   *
   * @public
   */
  getDefaultQueryTimeout(): number {
    return this.defaultQueryTimeoutMs;
  }

  // ============================================================
  // CRUD Operations (Default implementations, can override)
  // ============================================================

  /**
   * Select multiple records from a table.
   *
   * @remarks
   * Default implementation builds a SELECT query and executes it.
   * Subclasses can override for optimization or dialect-specific features.
   *
   * @param table - Table name
   * @param options - Select options (filtering, sorting, pagination)
   * @returns Array of matching records
   *
   * @throws {DatabaseError} If query fails
   *
   * @example
   * ```typescript
   * const users = await adapter.select('users', {
   *   where: { and: [{ column: 'role', op: '=', value: 'admin' }] },
   *   orderBy: [{ column: 'created_at', direction: 'desc' }],
   *   limit: 10
   * });
   * ```
   */
  async select<T = unknown>(
    table: string,
    options?: SelectOptions,
    executor?: unknown
  ): Promise<T[]> {
    // Drizzle query API path: use when table resolver has a Drizzle table object
    const tableObj = this.getTableObject(table);
    if (tableObj) {
      try {
        // Run on the transaction's executor when one is supplied, otherwise the
        // pooled instance. Without this, a read inside a transaction would use
        // the pool and miss rows written earlier in the same uncommitted tx.
        // getDrizzle() returns unknown - explicit any generic for dialect-specific Drizzle API
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = executor ?? this.getDrizzle<any>();
        // Honor the columns projection when provided: select only the requested
        // columns instead of every column, so callers can avoid transferring
        // large columns (e.g. JSON snapshots) they do not need. Falls back to a
        // full select when no columns are requested or none resolve.
        const projection = options?.columns?.length
          ? this.buildColumnProjection(tableObj, options.columns)
          : undefined;
        // `distinct` asks for each row once: SELECT DISTINCT, over the
        // projection when there is one, which every dialect's builder has.
        const selecting = options?.distinct
          ? db.selectDistinct.bind(db)
          : db.select.bind(db);
        let query = projection
          ? selecting(projection).from(tableObj)
          : selecting().from(tableObj);

        if (options?.where) {
          const whereCondition = buildDrizzleWhere(
            tableObj as never,
            options.where,
            this.dialect
          );
          if (whereCondition) {
            query = query.where(whereCondition);
          }
        }

        // Guarded, so `getColumns` is not reached for a select that does not
        // order. Hoisting it out of this check ran it on every select and broke
        // callers whose table handle cannot answer it.
        if (options?.orderBy?.length) {
          const orderClauses = buildDrizzleOrderBy(
            getColumns(tableObj as never),
            options.orderBy
          );
          if (orderClauses.length) {
            query = query.orderBy(...orderClauses);
          }
        }

        if (options?.limit !== undefined) {
          query = query.limit(options.limit);
        }

        if (options?.offset !== undefined) {
          query = query.offset(options.offset);
        }

        // A lock request is only meaningful inside a transaction, on EVERY
        // dialect. On the row-locking dialects the pooled connection autocommits
        // the SELECT, releasing the lock the instant it returns; on SQLite the
        // lock IS the transaction (BEGIN IMMEDIATE serializes writers), so a
        // pooled call takes no lock at all. Either way a `forUpdate` without a
        // transaction executor is silent false safety and reopens the TOCTOU
        // window it was meant to close, so fail fast regardless of dialect.
        if (options?.forUpdate && !executor) {
          throw this.createDatabaseError(
            "query",
            "forUpdate requires a transaction executor: a lock request on the pooled connection takes no durable lock and cannot prevent a concurrent write.",
            undefined
          );
        }
        // The shared lock is refused on the pool for the same reason.
        if (options?.forShare && !executor) {
          throw this.createDatabaseError(
            "query",
            "forShare requires a transaction executor: a lock request on the pooled connection takes no durable lock and cannot prevent a concurrent write.",
            undefined
          );
        }

        // Row-lock the selected rows for the rest of the transaction and read the
        // latest committed values (not the transaction's snapshot). SQLite has no
        // FOR UPDATE and needs none (BEGIN IMMEDIATE serializes its writers), so
        // it is skipped there. A shared lock is the same read with a lock other
        // readers may also hold; the exclusive one wins when both are asked.
        if (options?.forUpdate && this.dialect !== "sqlite") {
          query = query.for("update");
        } else if (options?.forShare && this.dialect !== "sqlite") {
          query = query.for("share");
        }

        return (await query) as T[];
      } catch (error) {
        throw this.handleQueryError(error, "select", table);
      }
    }

    // A table the resolver does not hold: refused with the adapters' own code,
    // so core answers it as an entity this instance has not registered.
    throw tableNotRegisteredError(table);
  }

  /**
   * Select a single record from a table.
   *
   * @remarks
   * Default implementation uses `select()` with limit 1 and returns first result.
   * Returns null if no matching record is found.
   *
   * @param table - Table name
   * @param options - Select options
   * @returns First matching record or null
   *
   * @throws {DatabaseError} If query fails
   *
   * @example
   * ```typescript
   * const user = await adapter.selectOne('users', {
   *   where: { and: [{ column: 'email', op: '=', value: 'user@example.com' }] }
   * });
   * ```
   */
  /** The registered table object, or a refusal naming what is missing. */
  private requireTableObject(table: string): unknown {
    const tableObj = this.getTableObject(table);
    if (tableObj) return tableObj;
    throw tableNotRegisteredError(table);
  }

  /**
   * The columns a distinct count groups by, or `undefined` for a row count.
   *
   * 🔴 EVERY named column must resolve, not merely one of them. A `distinctOn`
   * naming no column this table has would fall through to a row count, and one
   * naming a valid column beside a misspelled or since-removed column would
   * count distinct over a NARROWER key than the caller asked for. Both answer a
   * different question than the one asked, silently; the second is the worse of
   * the two, because a subset key groups more rows together and so UNDERCOUNTS,
   * which reads as a plausible number rather than as a fault. Refused here,
   * where the mistake was made, rather than surfacing as a wrong figure.
   */
  private countProjection(
    tableObj: unknown,
    table: string,
    options: CountOptions | undefined
  ): Record<string, unknown> | undefined {
    const distinctOn = options?.distinctOn;
    if (!distinctOn?.length) return undefined;
    const { projection, unresolved } = this.resolveColumns(
      tableObj,
      distinctOn
    );
    if (unresolved.length > 0) {
      throw this.createDatabaseError(
        "query",
        `distinctOn names ${unresolved.length === 1 ? "a column" : "columns"} that do not exist on "${table}": ${unresolved.join(", ")}`,
        undefined
      );
    }
    return projection;
  }

  /**
   * `COUNT(*)` over a `SELECT DISTINCT` subquery.
   *
   * Its own function because it is a genuinely different query from the plain
   * count rather than a variation on one, and because building both inline made
   * the public method a chain of decisions the complexity gate objected to
   * before a reader would have.
   */
  private async countDistinctRows(
    db: CountCapableDb,
    tableObj: unknown,
    projection: Record<string, unknown>,
    where: unknown
  ): Promise<number> {
    const inner = db.selectDistinct(projection).from(tableObj).$dynamic();
    const distinctRows = where ? inner.where(where) : inner;
    const [row] = await db
      .select({ value: count() })
      .from(distinctRows.as("nextly_distinct"));
    return Number(row?.value ?? 0);
  }

  /** `COUNT(*)` over the table itself. */
  private async countAllRows(
    db: CountCapableDb,
    tableObj: unknown,
    where: unknown
  ): Promise<number> {
    const base = db.select({ value: count() }).from(tableObj).$dynamic();
    const [row] = await (where ? base.where(where) : base);
    return Number(row?.value ?? 0);
  }

  /**
   * How many rows match, or how many DISTINCT combinations of some columns do.
   *
   * The data layer had no count at all: collection totals go through
   * `countEntries`, an access-controlled path built for collection tables, and
   * nothing could count a system table. A caller wanting one selected the rows
   * and measured the array, which transfers every row to learn a number and
   * cannot be bounded without making the number wrong.
   *
   * 🔴 `distinctOn` compiles to `COUNT(*)` over a `SELECT DISTINCT` SUBQUERY,
   * never to `COUNT(DISTINCT a, b)`. The inline form is not portable and fails
   * in the direction that is hardest to notice -- MySQL accepts it, PostgreSQL
   * needs a row constructor, and SQLite rejects it outright with "wrong number
   * of arguments to function count()" -- so a query written against one engine
   * is a syntax error on another. The subquery is the single form all three
   * accept, and building it here rather than at each call site is what keeps
   * the answer identical per dialect.
   */
  async count(
    table: string,
    options?: CountOptions,
    executor?: unknown
  ): Promise<number> {
    const tableObj = this.requireTableObject(table);
    try {
      // Transaction executor when supplied, otherwise the pooled instance —
      // narrowed to the fragment of the select builder these two counts use,
      // the same seam `update` takes with `UpdateCapableDb`.
      const db = (executor ??
        this.getDrizzle<CountCapableDb>()) as CountCapableDb;
      const where = options?.where
        ? buildDrizzleWhere(tableObj as never, options.where, this.dialect)
        : undefined;
      const projection = this.countProjection(tableObj, table, options);
      return projection
        ? await this.countDistinctRows(db, tableObj, projection, where)
        : await this.countAllRows(db, tableObj, where);
    } catch (error) {
      throw this.handleQueryError(error, "count", table);
    }
  }

  async selectOne<T = unknown>(
    table: string,
    options?: SelectOptions,
    executor?: unknown
  ): Promise<T | null> {
    const results = await this.select<T>(
      table,
      { ...options, limit: 1 },
      executor
    );
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Insert a single record into a table.
   *
   * @remarks
   * Default implementation handles databases with and without RETURNING support.
   * For databases without RETURNING (MySQL), performs INSERT followed by SELECT.
   *
   * @param table - Table name
   * @param data - Record data to insert
   * @param options - Insert options
   * @returns Inserted record (with RETURNING columns if specified)
   *
   * @throws {DatabaseError} If insert fails
   *
   * @example
   * ```typescript
   * const user = await adapter.insert('users', {
   *   email: 'user@example.com',
   *   name: 'John Doe'
   * }, { returning: ['id', 'email', 'created_at'] });
   * ```
   */
  async insert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    options?: InsertOptions
  ): Promise<T> {
    // Drizzle query API path
    const tableObj = this.getTableObject(table);
    if (tableObj) {
      try {
        // Map snake_case keys to Drizzle JS property names
        const mappedData = this.mapDataToColumnNames(tableObj, data);
        // getDrizzle() returns unknown - explicit any generic for dialect-specific Drizzle API
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = this.getDrizzle<any>();
        const caps = this.getCapabilities();

        const returning = options?.returning;
        // An empty array means "no columns back": skip RETURNING entirely and,
        // on MySQL, skip the select-back reread. Useful for callers that ignore
        // the insert result and don't want a large row (e.g. a JSON snapshot)
        // materialized. `"*"` returns all; a specific list is projected.
        const wantsReturning =
          returning != null &&
          !(Array.isArray(returning) && returning.length === 0);

        if (caps.supportsReturning && wantsReturning) {
          const projection = this.buildColumnProjection(tableObj, returning);
          const insertQuery = db.insert(tableObj).values(mappedData);
          const result = await (projection
            ? insertQuery.returning(projection)
            : insertQuery.returning());
          return (Array.isArray(result) ? result[0] : result) as T;
        }

        const result = await db.insert(tableObj).values(mappedData);

        // For databases without RETURNING (MySQL): select back the inserted
        // record, projecting only the requested columns so unrequested ones
        // (a large JSON snapshot) are not read and decoded.
        if (
          !caps.supportsReturning &&
          wantsReturning &&
          data.id !== undefined
        ) {
          return (await this.selectOne<T>(table, {
            columns: returning === "*" ? undefined : returning,
            where: {
              and: [{ column: "id", op: "=", value: data.id as SqlParam }],
            },
          })) as T;
        }

        return (Array.isArray(result) ? result[0] : result) as T;
      } catch (error) {
        throw this.handleQueryError(error, "insert", table);
      }
    }

    throw tableNotRegisteredError(table);
  }

  /**
   * Insert multiple records into a table.
   *
   * @remarks
   * Default implementation performs individual inserts in sequence.
   * Subclasses can override for bulk insert optimization (e.g., COPY in PostgreSQL).
   *
   * @param table - Table name
   * @param data - Array of records to insert
   * @param options - Insert options
   * @returns Inserted records (with RETURNING columns if specified)
   *
   * @throws {DatabaseError} If insert fails
   *
   * @example
   * ```typescript
   * const users = await adapter.insertMany('users', [
   *   { email: 'user1@example.com', name: 'User 1' },
   *   { email: 'user2@example.com', name: 'User 2' }
   * ], { returning: ['id'] });
   * ```
   */
  async insertMany<T = unknown>(
    table: string,
    data: Record<string, unknown>[],
    options?: InsertOptions
  ): Promise<T[]> {
    if (data.length === 0) {
      return [];
    }

    // Default implementation: insert one by one
    // Subclasses can override for bulk optimization
    const results: T[] = [];
    for (const record of data) {
      const result = await this.insert<T>(table, record, options);
      results.push(result);
    }
    return results;
  }

  /**
   * Update records in a table.
   *
   * @remarks
   * Default implementation builds an UPDATE query with WHERE clause.
   * Returns updated records if RETURNING is supported and requested.
   *
   * @param table - Table name
   * @param data - Data to update
   * @param where - Conditions for records to update
   * @param options - Update options
   * @returns Updated records (with RETURNING columns if specified)
   *
   * @throws {DatabaseError} If update fails
   *
   * @example
   * ```typescript
   * const updated = await adapter.update('users',
   *   { status: 'active' },
   *   { and: [{ column: 'id', op: '=', value: userId }] },
   *   { returning: ['id', 'status', 'updated_at'] }
   * );
   * ```
   */
  async update<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    where: WhereClause,
    options?: UpdateOptions,
    executor?: unknown
  ): Promise<T[]> {
    // Drizzle query API path
    const tableObj = this.getTableObject(table);
    if (tableObj) {
      try {
        // Transaction executor when supplied, otherwise the pooled instance.
        // getDrizzle() returns unknown - explicit any generic for dialect-specific Drizzle API
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = executor ?? this.getDrizzle<any>();
        const caps = this.getCapabilities();
        // Map snake_case keys to Drizzle JS property names
        const mappedData = this.mapDataToColumnNames(tableObj, data);
        let query = db.update(tableObj).set(mappedData);

        const whereCondition = buildDrizzleWhere(
          tableObj as never,
          where,
          this.dialect
        );
        if (whereCondition) {
          query = query.where(whereCondition);
        }

        if (caps.supportsReturning && options?.returning) {
          return (await query.returning()) as T[];
        }

        await query;

        // For databases without RETURNING: select back the updated records on
        // the same executor so a transactional update reads its own writes.
        if (!caps.supportsReturning && options?.returning) {
          return await this.select<T>(table, { where }, executor);
        }

        return [] as T[];
      } catch (error) {
        throw this.handleQueryError(error, "update", table);
      }
    }

    throw tableNotRegisteredError(table);
  }

  /**
   * Update records in a table and report how many rows the statement affected.
   *
   * The count is the whole return value, mirroring `delete`. `update` cannot answer this: without
   * `returning` it discards the driver's count, and WITH `returning` on a dialect that lacks
   * RETURNING it re-SELECTs using the same WHERE — so a conditional update that just changed a
   * column named in that WHERE reads back zero rows and a write that landed reports as unmatched.
   * Reading the driver's own count has no second query to disagree with the first.
   *
   * 🔴 MySQL reports CHANGED rows, not matched rows: an UPDATE that matches a row but writes values
   * identical to what it holds counts zero. A caller using this as a compare-and-set must therefore
   * include a column the write always moves — a version bump, a timestamp with enough resolution —
   * so that matched implies changed. Postgres (`rowCount`) and SQLite (`changes`) count matched
   * rows and do not need the precaution, which is exactly why it cannot be dropped: the dialect
   * where the distinction exists is the one with no RETURNING to fall back on.
   */
  async updateCount(
    table: string,
    data: Record<string, unknown>,
    where: WhereClause,
    executor?: unknown
  ): Promise<number> {
    const tableObj = this.getTableObject(table);
    if (tableObj) {
      try {
        // Transaction executor when supplied, otherwise the pooled instance — narrowed to the
        // fragment of the update builder this method uses rather than the whole dialect-specific
        // surface, which is the same seam `getDrizzle<{ execute }>()` above takes. `where` returns
        // a thenable rather than a further builder, so awaiting either branch is what the type
        // says: the statement is issued whether or not a condition was added.
        const db = (executor ??
          this.getDrizzle<UpdateCapableDb>()) as UpdateCapableDb;
        const mappedData = this.mapDataToColumnNames(tableObj, data);
        const statement = db.update(tableObj).set(mappedData);

        const whereCondition = buildDrizzleWhere(
          tableObj as never,
          where,
          this.dialect
        );
        const result = await (whereCondition
          ? statement.where(whereCondition)
          : statement);
        return affectedRowCount(result);
      } catch (error) {
        throw this.handleQueryError(error, "update", table);
      }
    }

    throw tableNotRegisteredError(table);
  }

  /**
   * Delete records from a table.
   *
   * @remarks
   * Default implementation builds a DELETE query with WHERE clause.
   * Returns the number of deleted records.
   *
   * @param table - Table name
   * @param where - Conditions for records to delete
   * @param options - Delete options
   * @returns Number of deleted records
   *
   * @throws {DatabaseError} If delete fails
   *
   * @example
   * ```typescript
   * const count = await adapter.delete('users', {
   *   and: [{ column: 'status', op: '=', value: 'inactive' }]
   * });
   * console.log(`Deleted ${count} users`);
   * ```
   */
  async delete(
    table: string,
    where: WhereClause,
    _options?: DeleteOptions,
    executor?: unknown
  ): Promise<number> {
    // Drizzle query API path
    const tableObj = this.getTableObject(table);
    if (tableObj) {
      try {
        // Transaction executor when supplied, otherwise the pooled instance.
        // getDrizzle() returns unknown - explicit any generic for dialect-specific Drizzle API
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = executor ?? this.getDrizzle<any>();
        let query = db.delete(tableObj);

        const whereCondition = buildDrizzleWhere(
          tableObj as never,
          where,
          this.dialect
        );
        if (whereCondition) {
          query = query.where(whereCondition);
        }

        const result = await query;
        return affectedRowCount(result);
      } catch (error) {
        throw this.handleQueryError(error, "delete", table);
      }
    }

    throw tableNotRegisteredError(table);
  }

  /**
   * Upsert (INSERT or UPDATE) a record.
   *
   * @remarks
   * Default implementation uses dialect-specific ON CONFLICT syntax.
   * PostgreSQL/SQLite: ON CONFLICT ... DO UPDATE
   * MySQL: the MySQL adapter overrides this, resolving the conflict by the
   * conflict columns (see its `upsert`)
   *
   * @param table - Table name
   * @param data - Record data
   * @param options - Upsert options (must specify conflict columns)
   * @returns Upserted record (with RETURNING columns if specified)
   *
   * @throws {DatabaseError} If upsert fails
   *
   * @example
   * ```typescript
   * const user = await adapter.upsert('users', {
   *   email: 'user@example.com',
   *   name: 'Updated Name'
   * }, {
   *   conflictColumns: ['email'],
   *   updateColumns: ['name'],
   *   returning: ['id', 'email', 'name']
   * });
   * ```
   */
  async upsert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    options: UpsertOptions,
    executor?: unknown
  ): Promise<T> {
    // Drizzle query API path
    const tableObj = this.getTableObject(table);
    if (tableObj) {
      try {
        // Transaction executor when supplied, otherwise the pooled instance.
        // getDrizzle() returns unknown - explicit any generic for dialect-specific Drizzle API
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = executor ?? this.getDrizzle<any>();
        const caps = this.getCapabilities();
        const columns = getColumns(tableObj as never);

        // Build conflict target columns
        const conflictTarget = options.conflictColumns
          .map(col => columns[col])
          .filter(Boolean);

        // Build update set (exclude conflict columns from update data)
        const conflictSet = new Set(options.conflictColumns);
        const updateData: Record<string, unknown> = {};
        const updateColumns = options.updateColumns ?? Object.keys(data);
        for (const key of updateColumns) {
          if (!conflictSet.has(key) && key in data) {
            updateData[key] = data[key];
          }
        }

        // Nothing left to update means "insert, or keep the row that is
        // there": the write-once a caller inside a transaction needs. It must
        // not raise on a repeat — on PostgreSQL a failed statement aborts the
        // whole transaction — so it is spelled as a conflict that changes
        // nothing, and the row that stands is read back below.
        const keepExisting = Object.keys(updateData).length === 0;
        this.assertUpsertTarget(table, data, options, keepExisting);

        let query;
        if (caps.supportsOnConflict) {
          // PostgreSQL/SQLite: ON CONFLICT ... DO UPDATE, or DO NOTHING when
          // there is nothing to update.
          const inserted = db.insert(tableObj).values(data);
          query = keepExisting
            ? inserted.onConflictDoNothing({ target: conflictTarget })
            : inserted.onConflictDoUpdate({
                target: conflictTarget,
                set: updateData,
              });
        } else {
          // A dialect without a conflict clause overrides `upsert` (the MySQL
          // adapter does); this plain insert is only the fallback for one that
          // has not.
          query = db.insert(tableObj).values(data);
        }

        if (caps.supportsReturning) {
          const result = await query.returning();
          const row = Array.isArray(result) ? result[0] : result;
          // DO NOTHING returns no row on a conflict; the row that stands is
          // read back instead, the same way on every dialect.
          if (row !== undefined) return row as T;
        } else {
          await query;
        }

        // Read the row that stands back by every conflict column, on the same
        // executor so a transactional upsert reads its own write. A second
        // statement, so a row deleted between the two is not returned (see
        // `UpsertOptions.updateColumns`); never one this call did not find, so
        // "created" read from the returned id stays exact.
        const conflictValues = options.conflictColumns.map(
          column => [column, data[column]] as const
        );
        if (
          conflictValues.length > 0 &&
          conflictValues.every(([, value]) => value !== undefined)
        ) {
          return (await this.selectOne<T>(
            table,
            {
              where: {
                and: conflictValues.map(([column, value]) => ({
                  column,
                  op: "=" as const,
                  value: value as SqlParam,
                })),
              },
            },
            executor
          )) as T;
        }

        return data as T;
      } catch (error) {
        throw this.handleQueryError(error, "upsert", table);
      }
    }

    throw tableNotRegisteredError(table);
  }

  // ============================================================
  // Migration Support (Default implementations, can override)
  // ============================================================

  /**
   * Run pending migrations.
   *
   * @remarks
   * Default implementation is a placeholder. Subclasses should implement
   * migration tracking and execution logic.
   *
   * @param migrations - Array of migrations to run
   * @returns Migration result with applied and pending migrations
   *
   * @throws {DatabaseError} If migration fails
   */
  // Base implementation throws synchronously; dialect adapters override with async logic.
  // eslint-disable-next-line @typescript-eslint/require-await
  async migrate(_migrations: Migration[]): Promise<MigrationResult> {
    // Base implementation: migrate() requires dialect-specific migrator import.
    // Dialect adapters (PostgresAdapter, MySqlAdapter, SqliteAdapter) should
    // override this with their specific drizzle-orm migrator.
    throw this.createDatabaseError(
      "query",
      "migrate() must be implemented by dialect-specific adapter. " +
        "Use PostgresAdapter, MySqlAdapter, or SqliteAdapter.",
      undefined
    );
  }

  /**
   * Rollback the last migration.
   *
   * @remarks
   * Default implementation is a placeholder. Subclasses should implement
   * migration rollback logic.
   *
   * @returns Migration result after rollback
   *
   * @throws {DatabaseError} If rollback fails
   */
  // Base implementation throws synchronously; dialect adapters override with async logic.
  // eslint-disable-next-line @typescript-eslint/require-await
  async rollback(): Promise<MigrationResult> {
    // Base implementation: rollback requires dialect-specific handling.
    // Dialect adapters should override this.
    throw this.createDatabaseError(
      "query",
      "rollback() must be implemented by dialect-specific adapter. " +
        "Use PostgresAdapter, MySqlAdapter, or SqliteAdapter.",
      undefined
    );
  }

  /**
   * Get migration status.
   *
   * @remarks
   * Default implementation is a placeholder. Subclasses should implement
   * migration status checking.
   *
   * @returns Current migration status
   *
   * @throws {DatabaseError} If status check fails
   */
  async getMigrationStatus(): Promise<MigrationResult> {
    // Query the drizzle migrations tracking table for applied migrations
    try {
      const rows = await this.executeQuery<{
        id: number;
        hash: string;
        created_at: number;
      }>(`SELECT * FROM "__drizzle_migrations" ORDER BY created_at ASC`);

      const applied = rows.map(r => ({
        id: String(r.id),
        name: r.hash,
        appliedAt: new Date(r.created_at),
        checksum: r.hash,
      }));
      return {
        applied,
        pending: [],
        current: applied.length > 0 ? applied[applied.length - 1].id : null,
      };
    } catch {
      // Table may not exist yet if no migrations have been applied
      return { applied: [], pending: [], current: null };
    }
  }

  // ============================================================
  // Schema Operations (Default implementations, can override)
  // ============================================================

  /**
   * Create a new table.
   *
   * @remarks
   * Default implementation is a placeholder. Subclasses should implement
   * table creation logic.
   *
   * @param definition - Table definition
   * @param options - Creation options
   *
   * @throws {DatabaseError} If table creation fails
   */
  async createTable(
    definition: TableDefinition,
    options?: CreateTableOptions
  ): Promise<void> {
    // Build CREATE TABLE SQL from the TableDefinition
    const columnDefs = definition.columns.map(col => {
      let colSql = `${this.escapeIdentifier(col.name)} ${col.type.toUpperCase()}`;
      if (col.primaryKey) colSql += " PRIMARY KEY";
      if (col.nullable === false) colSql += " NOT NULL";
      if (col.unique) colSql += " UNIQUE";
      if (col.default !== undefined) {
        colSql += ` DEFAULT ${renderDefaultValue(col.default, col.name)}`;
      }
      return colSql;
    });

    const ifNotExists = options?.ifNotExists !== false ? "IF NOT EXISTS " : "";
    const query = `CREATE TABLE ${ifNotExists}${this.escapeIdentifier(definition.name)} (\n  ${columnDefs.join(",\n  ")}\n)`;

    try {
      await this.executeQuery(query);
    } catch (error) {
      throw this.handleQueryError(error, "createTable", definition.name);
    }
  }

  /**
   * Drop a table.
   *
   * @remarks
   * Default implementation is a placeholder. Subclasses should implement
   * table dropping logic.
   *
   * @param tableName - Name of table to drop
   * @param options - Drop options
   *
   * @throws {DatabaseError} If table drop fails
   */
  async dropTable(
    tableName: string,
    options?: DropTableOptions
  ): Promise<void> {
    const ifExists = options?.ifExists !== false ? "IF EXISTS " : "";
    const cascade = options?.cascade ? " CASCADE" : "";
    const query = `DROP TABLE ${ifExists}${this.escapeIdentifier(tableName)}${cascade}`;

    try {
      await this.executeQuery(query);
    } catch (error) {
      throw this.handleQueryError(error, "dropTable", tableName);
    }
  }

  /**
   * Alter an existing table.
   *
   * @remarks
   * Default implementation is a placeholder. Subclasses should implement
   * table alteration logic.
   *
   * @param tableName - Name of table to alter
   * @param operations - Alteration operations
   * @param options - Alter options
   *
   * @throws {DatabaseError} If table alteration fails
   */
  async alterTable(
    tableName: string,
    operations: AlterTableOperation[],
    _options?: AlterTableOptions
  ): Promise<void> {
    const quotedTable = this.escapeIdentifier(tableName);

    for (const op of operations) {
      let query: string;

      switch (op.kind) {
        case "add_column": {
          let colDef = `${this.escapeIdentifier(op.column.name)} ${op.column.type.toUpperCase()}`;
          if (op.column.nullable === false) colDef += " NOT NULL";
          if (op.column.unique) colDef += " UNIQUE";
          if (op.column.default !== undefined) {
            const defaultVal =
              typeof op.column.default === "object" &&
              op.column.default !== null &&
              "sql" in op.column.default
                ? op.column.default.sql
                : typeof op.column.default === "string"
                  ? `'${op.column.default}'`
                  : String(op.column.default);
            colDef += ` DEFAULT ${defaultVal}`;
          }
          query = `ALTER TABLE ${quotedTable} ADD COLUMN ${colDef}`;
          break;
        }
        case "drop_column": {
          const cascade = op.cascade ? " CASCADE" : "";
          query = `ALTER TABLE ${quotedTable} DROP COLUMN ${this.escapeIdentifier(op.columnName)}${cascade}`;
          break;
        }
        case "rename_column":
          query = `ALTER TABLE ${quotedTable} RENAME COLUMN ${this.escapeIdentifier(op.from)} TO ${this.escapeIdentifier(op.to)}`;
          break;
        case "modify_column": {
          // ALTER COLUMN ... TYPE is PostgreSQL syntax; MySQL uses MODIFY COLUMN
          // Dialect adapters can override for specific syntax
          query = `ALTER TABLE ${quotedTable} ALTER COLUMN ${this.escapeIdentifier(op.column.name)} TYPE ${op.column.type.toUpperCase()}`;
          break;
        }
        case "add_constraint":
          {
            // Constraint SQL depends on the constraint type
            const constraintCols = op.constraint.columns ?? [];
            const colList = constraintCols
              .map(c => this.escapeIdentifier(c))
              .join(", ");
            if (op.constraint.type === "check" && op.constraint.expression) {
              query = `ALTER TABLE ${quotedTable} ADD CONSTRAINT ${this.escapeIdentifier(op.constraint.name)} CHECK (${op.constraint.expression})`;
            } else {
              query = `ALTER TABLE ${quotedTable} ADD CONSTRAINT ${this.escapeIdentifier(op.constraint.name)} ${op.constraint.type.toUpperCase()} (${colList})`;
            }
            break;
          }
          break;
        case "drop_constraint": {
          const cascadeConstraint = op.cascade ? " CASCADE" : "";
          query = `ALTER TABLE ${quotedTable} DROP CONSTRAINT ${this.escapeIdentifier(op.constraintName)}${cascadeConstraint}`;
          break;
        }
        default:
          throw this.createDatabaseError(
            "query",
            `Unsupported alter table operation: ${(op as { kind: string }).kind}`,
            undefined
          );
      }

      try {
        await this.executeQuery(query);
      } catch (error) {
        throw this.handleQueryError(error, "alterTable", tableName);
      }
    }
  }

  /**
   * Check if a table exists in the database.
   *
   * @remarks
   * Uses dialect-specific information schema queries to check table existence.
   * This is useful for development mode auto-sync to determine whether to
   * CREATE or DROP/CREATE tables.
   *
   * @param tableName - Name of table to check
   * @param schema - Optional schema name (defaults to 'public' for PostgreSQL)
   * @returns True if table exists, false otherwise
   *
   * @throws {DatabaseError} If query fails
   *
   * @example
   * ```typescript
   * const exists = await adapter.tableExists('users');
   * if (exists) {
   *   await adapter.dropTable('users');
   * }
   * await adapter.createTable(userTableDef);
   * ```
   */
  async tableExists(tableName: string, schema?: string): Promise<boolean> {
    return this.tableExistsThrough(
      {
        execute: <T = unknown>(sql: string, params?: SqlParam[]) =>
          this.executeQuery<T>(sql, params),
      },
      tableName,
      schema
    );
  }

  /**
   * {@link tableExists}, asked through `executor`: the same catalogue lookup,
   * run on a transaction's own connection when the caller holds one. Asking
   * the pool from inside a transaction waits, on a pool of one, for the
   * connection that transaction holds; and as a catalogue read it cannot fail
   * the way a statement against a missing table would, which on PostgreSQL
   * aborts the transaction.
   *
   * @internal For Nextly's own packages; not part of the adapter's public API.
   */
  async tableExistsThrough(
    executor: CatalogExecutor,
    tableName: string,
    schema?: string
  ): Promise<boolean> {
    try {
      return await tableExistsOn(executor, this.dialect, tableName, schema);
    } catch (error) {
      throw this.handleQueryError(error, "tableExists", tableName);
    }
  }

  /**
   * Get list of all tables in the database.
   *
   * @remarks
   * Uses dialect-specific information schema queries to list tables.
   * Useful for detecting orphaned tables or validating schema state.
   *
   * @param schema - Optional schema name (defaults to 'public' for PostgreSQL)
   * @returns Array of table names
   *
   * @throws {DatabaseError} If query fails
   */
  async listTables(schema?: string): Promise<string[]> {
    return this.listTablesThrough(
      {
        execute: <T = unknown>(sql: string, params?: SqlParam[]) =>
          this.executeQuery<T>(sql, params),
      },
      schema
    );
  }

  /**
   * {@link listTables}, asked through `executor`: the same catalogue listing,
   * run on a transaction's own connection when the caller holds one, as
   * {@link tableExistsThrough} asks for one table. Asking the pool from inside
   * a transaction would wait, on a pool of one, for the connection that
   * transaction holds, and would not see the tables it has dropped.
   *
   * @internal For Nextly's own packages; not part of the adapter's public API.
   */
  async listTablesThrough(
    executor: CatalogExecutor,
    schema?: string
  ): Promise<string[]> {
    try {
      let sql: string;
      const params: SqlParam[] = [];

      switch (this.dialect) {
        case "postgresql":
          sql = `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = $1
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
          `;
          params.push(schema ?? "public");
          break;

        case "mysql":
          // The alias matters: MySQL 8's information_schema returns the
          // column key as uppercase TABLE_NAME without it, so `row.table_name`
          // was undefined and every caller mapping the rows crashed.
          sql = `
            SELECT table_name AS table_name
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
          `;
          break;

        case "sqlite":
          sql = `
            SELECT name as table_name
            FROM sqlite_master
            WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
            ORDER BY name
          `;
          break;

        default:
          throw this.createDatabaseError(
            "query",
            `listTables not implemented for dialect: ${String(this.dialect)}`,
            undefined
          );
      }

      const results = await executor.execute<{ table_name: string }>(
        sql,
        params
      );

      return results.map(row => row.table_name);
    } catch (error) {
      throw this.handleQueryError(error, "listTables", "");
    }
  }

  // ============================================================
  // Protected Utilities
  // ============================================================

  // Old raw SQL query builders (buildSelectQuery, buildInsertQuery, buildUpdateQuery,
  // buildDeleteQuery, buildUpsertQuery, buildWhereClause, buildPlaceholder,
  // buildPlaceholders) have been removed. CRUD methods now use Drizzle query API
  // via the TableResolver set during boot. See drizzle-where.ts for where clause
  // translation.

  // NOTE: The following content up to escapeIdentifier has been removed.
  // If you're looking for the old query builder methods, see git history
  // (commit before "refactor: remove dead SQL builder code").

  /**
   * Escape a table or column identifier.
   *
   * @remarks
   * Default uses double quotes (SQL standard).
   * MySQL adapter should override to use backticks.
   *
   * @param identifier - Identifier to escape
   * @returns Escaped identifier
   *
   * @protected
   */
  protected escapeIdentifier(identifier: string): string {
    // SQL standard: double quotes
    // MySQL uses backticks, override in MySqlAdapter
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  /**
   * Create a DatabaseError with proper error kind classification.
   *
   * @remarks
   * Protected helper for subclasses to create consistent errors.
   * Subclasses can override to add dialect-specific error classification.
   *
   * @param kind - Error kind
   * @param message - Error message
   * @param cause - Original error
   * @returns DatabaseError instance
   *
   * @protected
   */
  protected createDatabaseError(
    kind: DatabaseErrorKind,
    message: string,
    cause?: Error
  ): DatabaseError {
    return createDatabaseError({
      kind,
      message,
      cause,
    });
  }

  /**
   * Helper to create transaction context CRUD forwarding methods.
   *
   * @param txDb - Thunk returning the transaction-bound Drizzle executor
   * @returns Object providing forwarded CRUD and getDrizzle methods
   *
   * @protected
   */
  protected createTransactionForwarders(
    txDb: () => unknown
  ): TransactionCrudForwarders {
    return createTransactionForwarders(this, txDb);
  }

  /**
   * The Drizzle handles one transaction hands out; see
   * `transactionDrizzleHandles`. `build` makes an instance on the
   * transaction's own connection, with the relations config when given one.
   *
   * @protected
   */
  protected transactionDrizzleHandles<TBare>(
    build: (relations?: AnyRelations) => TBare
  ): {
    bare: () => TBare;
    withRelations: <T = unknown>(relations: AnyRelations) => T;
  } {
    return transactionDrizzleHandles(build);
  }

  /**
   * A transaction context's `update`, for each adapter to bind.
   *
   * Not forwarded to the pooled `update` the way `select` and `delete` are:
   * that one goes through the Drizzle query builder, which writes the columns
   * the runtime MODEL declares, and a transaction's update must reach the
   * columns the physical TABLE has — the localization transition window
   * writes a column the model has already moved to a companion table that
   * does not exist yet. The INSERT half of every transaction context already
   * builds its own statement for that reason; `update-statement.ts` is the
   * UPDATE half, spelled once for the three adapters, and this runs it: on
   * the transaction executor, classified with the operation and table named
   * as the pooled `update` classifies its failures, and read back through
   * `select` on the same executor when the caller asked for rows.
   *
   * That read is by the rows' IDENTITY where the dialect can report it: on
   * PostgreSQL and SQLite the statement carries `RETURNING <primary key>`, and
   * the read-back asks for exactly those rows — so a row another transaction
   * adds under the same predicate meanwhile is not among them, and an update
   * whose own write falsifies its predicate still reads its rows back. MySQL
   * has no RETURNING, so there the read re-runs the predicate, as the pooled
   * `update` always has on that dialect; a table with no primary key in its
   * model reads back the same way.
   *
   * @param txDb - thunk returning the transaction-bound Drizzle instance
   * @param run - how this dialect runs a statement on that instance, and the
   *   rows it returns when the statement carries RETURNING: better-sqlite3
   *   answers synchronously, the pooled drivers do not
   * @param bindUnmodeled - how a value binds when the model declares no
   *   column for it; a declared column binds through its own encoder
   * @returns the context's `update` method
   */
  protected transactionUpdate(
    txDb: () => unknown,
    run: (
      statement: SQL,
      returnsRows: boolean
    ) =>
      | Promise<Record<string, unknown>[] | undefined>
      | Record<string, unknown>[]
      | undefined,
    bindUnmodeled: (value: unknown) => unknown
  ): TransactionContext["update"] {
    return async <T = unknown>(
      table: string,
      data: Record<string, unknown>,
      where: WhereClause,
      options?: UpdateOptions
    ): Promise<T[]> => {
      const wantsRows = this.updateReturnsRows(options?.returning);
      const tableObj = this.resolvedTableObject(table);
      const identity =
        wantsRows && this.getCapabilities().supportsReturning
          ? this.identityColumns(tableObj)
          : [];
      let reported: Record<string, unknown>[] | undefined;
      try {
        reported = await run(
          this.buildTransactionUpdate(tableObj, table, data, where, {
            bindUnmodeled,
            returning: identity.map(key => sql`${sql.identifier(key.sqlName)}`),
          }),
          identity.length > 0
        );
      } catch (error) {
        throw this.handleQueryError(error, "update", table);
      }
      if (!wantsRows) return [];
      if (identity.length === 0 || !Array.isArray(reported)) {
        return this.select<T>(table, { where }, txDb());
      }
      // In bounded pieces: one predicate per reported row is a statement
      // SQLite refuses past a thousand branches and PostgreSQL past its
      // parameter limit, and a batch update can touch far more rows.
      const rows: T[] = [];
      for (let at = 0; at < reported.length; at += IDENTITY_READ_BACK_CHUNK) {
        rows.push(
          ...(await this.select<T>(
            table,
            {
              where: rowsByIdentity(
                identity,
                reported.slice(at, at + IDENTITY_READ_BACK_CHUNK)
              ),
            },
            txDb()
          ))
        );
      }
      return rows;
    };
  }

  /**
   * The columns that identify a row of this table, under both spellings: the
   * SQL name RETURNING reports and the Drizzle property name the query
   * builder's WHERE is addressed by. Columns flagged primary first; failing
   * that, the table-level primary key the dialect's table config carries
   * (`primaryKey({ columns })` leaves each column's flag false), which each
   * adapter reads through its own dialect. Empty when the model declares
   * neither, and the read-back falls back to the caller's predicate.
   */
  protected identityColumns(
    tableObj: Record<string, unknown>
  ): Array<{ jsName: string; sqlName: string }> {
    const columns: Array<[string, { name?: unknown; primary?: unknown }]> =
      Object.entries(getColumns(tableObj as never));
    const flagged = columns.filter(([, c]) => c.primary === true);
    const members =
      flagged.length > 0
        ? flagged
        : columns.filter(([, c]) =>
            this.compositePrimaryKey(tableObj).includes(c)
          );
    return members.flatMap(([jsName, c]) =>
      typeof c.name === "string" ? [{ jsName, sqlName: c.name }] : []
    );
  }

  /**
   * How a value binds to a column the model does not declare, on a driver
   * that binds scalars, dates and binary natively: a structured value goes
   * as JSON text, since what node-postgres and mysql2 make of a bare object
   * or array is not JSON. For the adapters to hand `transactionUpdate`.
   */
  protected bindUnmodeledStructuredAsJson(value: unknown): unknown {
    return bindStructuredAsJson(value);
  }

  /**
   * Refuse an upsert target every dialect would not answer alike: a conflict
   * column named twice, which SQLite rejects as no constraint's target and
   * MySQL would accept; and, when nothing is to be updated, a conflict column
   * left for the database to fill, since the row that stands is then read
   * back by a value the caller never gave. Shared with the dialects that
   * override `upsert`, so the refusals are one rule.
   */
  protected assertUpsertTarget(
    table: string,
    data: Record<string, unknown>,
    options: UpsertOptions,
    keepExisting: boolean
  ): void {
    const columns = options.conflictColumns;
    if (new Set(columns).size !== columns.length) {
      throw createDatabaseError({
        kind: "query",
        message: `upsert on ${table} names a conflict column more than once (${columns.join(", ")}).`,
      });
    }
    if (keepExisting && columns.some(column => data[column] === undefined)) {
      throw createDatabaseError({
        kind: "query",
        message: `upsert on ${table} needs a value for every conflict column (${columns.join(", ")}).`,
      });
    }
  }

  /**
   * The columns of a table-level `primaryKey({ columns })`, as the dialect's
   * table config reports them. The base class cannot read that config without
   * naming a dialect, so each adapter answers for its own; a dialect that does
   * not answer reports none.
   */
  protected compositePrimaryKey(_tableObj: Record<string, unknown>): object[] {
    return [];
  }

  /**
   * The registered table object, or the error every CRUD method throws without one.
   * Protected so each dialect's own statement builders (a transaction's insert, a
   * multi-row insert) refuse a table the resolver does not hold exactly as the
   * shared methods do, before any SQL is built or run.
   */
  protected resolvedTableObject(table: string): Record<string, unknown> {
    const tableObj = this.getTableObject(table);
    if (!tableObj || typeof tableObj !== "object") {
      throw tableNotRegisteredError(table);
    }
    return tableObj as Record<string, unknown>;
  }

  /**
   * The statement `transactionUpdate` runs.
   *
   * @throws when nothing would be written — every key `undefined`, or none at
   *   all. The query builder refused that too ("No values to set"), and a
   *   patch that names nothing is a caller's mistake rather than a write of
   *   nothing.
   */
  private buildTransactionUpdate(
    tableObj: Record<string, unknown>,
    table: string,
    data: Record<string, unknown>,
    where: WhereClause,
    binding: {
      bindUnmodeled: (value: unknown) => unknown;
      returning: SQL[];
    }
  ): SQL {
    const statement = buildUpdateStatement({
      table,
      tableObj,
      data,
      where,
      dialect: this.dialect,
      bindUnmodeled: binding.bindUnmodeled,
      returning: binding.returning,
    });
    if (!statement) {
      throw this.createDatabaseError(
        "query",
        `No values to set: the update of "${table}" names no column with a defined value.`,
        undefined
      );
    }
    return statement;
  }

  /**
   * Whether a transaction's `update` reads the rows it changed back: the
   * caller named columns, or `*`. An empty list, like no option at all, asks
   * for nothing and `update` answers `[]`, as it always has. The rows come
   * from a read of the update's own WHERE on its own transaction, so they are
   * the model's view of the row, decoded as every read is decoded — which is
   * what the query-builder update returned for them, and why the named list
   * selects nothing narrower.
   */
  private updateReturnsRows(returning: UpdateOptions["returning"]): boolean {
    return (
      returning !== undefined &&
      !(Array.isArray(returning) && returning.length === 0)
    );
  }

  /**
   * The driver's own error inside `error`: the first in its `cause` chain that
   * `isDriverError` recognises, or `error` itself when none does.
   *
   * A query that runs through Drizzle fails with Drizzle's `DrizzleQueryError`,
   * whose message is the SQL statement and which carries no driver code; the
   * driver's error, the only object that knows what actually went wrong, is
   * its `cause`. A dialect's {@link classifyError} classifies from what this
   * returns, so a failure reads the same whether or not Drizzle wrapped it.
   *
   * The walk is bounded, because an error chain can be made cyclic and a
   * classifier that can hang is worse than one that gives up. Falling back to
   * `error` keeps an error that carries no code anywhere classified as before.
   *
   * @param error - The error as it was caught
   * @param isDriverError - Whether a link in the chain is the driver's error
   * @returns The driver's error, or `error` when no link is
   */
  protected driverErrorIn<T extends { cause?: unknown }>(
    error: unknown,
    isDriverError: (candidate: T) => boolean
  ): T {
    let cursor: unknown = error;
    for (let depth = 0; depth < 10; depth++) {
      if (cursor === null || typeof cursor !== "object") break;
      const candidate = cursor as T;
      if (isDriverError(candidate)) return candidate;
      cursor = candidate.cause;
    }
    return (error ?? {}) as T;
  }

  /**
   * Classify an error into a DatabaseError.
   *
   * @remarks
   * Subclasses can override this method to add dialect-specific error code classification.
   *
   * @param error - Original error
   * @param sql - SQL statement that caused the error (optional)
   * @returns DatabaseError instance
   *
   * @protected
   */
  protected classifyError(error: unknown, sql?: string): DatabaseError {
    if (isDatabaseError(error)) {
      return error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    return this.createDatabaseError(
      "query",
      sql ? `Query failed: ${errorMessage}` : errorMessage,
      error instanceof Error ? error : undefined
    );
  }

  /**
   * Handle query errors and convert to DatabaseError.
   *
   * @remarks
   * Protected helper for consistent error handling across CRUD operations.
   * Delegates to `classifyError` and attaches operation and table context if not present.
   * Subclasses override `classifyError` to provide dialect-specific error code classification.
   *
   * @param error - Original error
   * @param operation - Operation that failed
   * @param table - Table name
   * @returns DatabaseError instance
   *
   * @protected
   */
  protected handleQueryError(
    error: unknown,
    operation: string,
    table: string
  ): DatabaseError {
    const dbError = this.classifyError(error);

    // Add operation context if not already present — asked of the context
    // this method writes, not of the operation's bare name. A driver message
    // that quotes the failed statement names the operation already (Drizzle's
    // `Failed query: update "posts" set …` on PostgreSQL and MySQL, whose
    // statements it spells in lower case), and so does any table or column
    // whose name contains the word; neither says which operation failed on
    // which table.
    const context = `${operation} operation failed on table '${table}'`;
    if (!dbError.message.includes(context)) {
      dbError.message = `${context}: ${dbError.message}`;
    }

    if (!dbError.table) {
      dbError.table = table;
    }

    return dbError;
  }
}

/**
 * How many reported rows one read-back statement names. Well under SQLite's
 * expression-depth limit of a thousand and its default variable limit, and
 * under PostgreSQL's parameter limit, with a composite key of several columns.
 */
const IDENTITY_READ_BACK_CHUNK = 200;

/**
 * The predicate that names exactly the rows a statement reported, addressed
 * by the Drizzle property names the where builder resolves: for a single-
 * column key one `IN` over the reported values; for a composite key one `and`
 * of every key column per row, `or`-ed together, so the key is matched as a
 * whole rather than column by column.
 */
function rowsByIdentity(
  identity: Array<{ jsName: string; sqlName: string }>,
  rows: Record<string, unknown>[]
): WhereClause {
  if (identity.length === 1) {
    const [key] = identity;
    return {
      and: [
        {
          column: key.jsName,
          op: "IN",
          value: rows.map(row => row[key.sqlName]) as WhereCondition["value"],
        },
      ],
    };
  }
  return {
    or: rows.map(
      (row): WhereClause => ({
        and: identity.map(
          (key): WhereCondition => ({
            column: key.jsName,
            op: "=",
            value: row[key.sqlName] as WhereCondition["value"],
          })
        ),
      })
    ),
  };
}

/**
 * Render a `ColumnDefinition.default` as a SQL fragment
 * for embedding in a `DEFAULT` clause. DDL is not protected by Drizzle's
 * prepared statements — these expressions are concatenated into raw SQL —
 * so we treat the default as untrusted input even though it currently
 * flows from server-side schema definitions: an admin-defined dynamic
 * collection would otherwise turn into RCE-on-DB instead of just CMS
 * admin.
 *
 * Rules:
 *
 *   - **null / number / boolean** → rendered as a SQL literal.
 *   - **string** → quoted; embedded `'` doubled; `;`, `\`, control
 *     characters, and null bytes rejected so they can't break out of
 *     the surrounding quote pair into adjacent DDL.
 *   - **`{ sql: "…" }`** → only the explicit allowlist of named
 *     functions below is honored (case-insensitive). Anything else is
 *     a hard error: the previous code embedded the raw `sql` string
 *     verbatim, which is the SQL injection primitive the audit flagged.
 */
const ALLOWED_DEFAULT_SQL_EXPRESSIONS = new Set([
  "current_timestamp",
  "now()",
  "gen_random_uuid()",
  "uuid_generate_v4()",
  "current_date",
  "current_time",
]);

function renderDefaultValue(value: unknown, columnName: string): string {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `DEFAULT for column "${columnName}" must be a finite number (got ${value}).`
      );
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value === "string") {
    if (/[;\\\n\r\0]/.test(value)) {
      throw new Error(
        `DEFAULT string for column "${columnName}" contains characters that are not allowed in DDL (no semicolons, backslashes, control chars, or null bytes).`
      );
    }
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (typeof value === "object" && value !== null && "sql" in value) {
    const raw = value.sql;
    if (typeof raw !== "string") {
      throw new Error(
        `DEFAULT for column "${columnName}" has a { sql } expression that is not a string.`
      );
    }
    const normalized = raw.trim().toLowerCase();
    if (!ALLOWED_DEFAULT_SQL_EXPRESSIONS.has(normalized)) {
      throw new Error(
        `DEFAULT for column "${columnName}" uses a SQL expression "${raw}" that is not on the allowlist. Allowed: ${[...ALLOWED_DEFAULT_SQL_EXPRESSIONS].join(", ")}.`
      );
    }
    return raw.trim();
  }
  throw new Error(
    `DEFAULT for column "${columnName}" has an unsupported type (${typeof value}).`
  );
}
