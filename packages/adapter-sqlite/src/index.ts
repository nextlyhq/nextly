/**
 * @nextlyhq/adapter-sqlite
 *
 * SQLite database adapter for Nextly.
 * Extends DrizzleAdapter from @nextlyhq/adapter-drizzle to provide SQLite-specific functionality.
 *
 * @remarks
 * This adapter uses the better-sqlite3 package for database connectivity and provides:
 * - Synchronous API wrapped for async interface compatibility
 * - Transactions the adapter runs itself (BEGIN IMMEDIATE / COMMIT / ROLLBACK), with nested calls run as savepoints
 * - CRUD operations with RETURNING clause support (SQLite 3.35+)
 * - WAL mode for better concurrent read performance
 * - In-memory and file-based database support
 *
 * @example
 * ```typescript
 * import { createSqliteAdapter } from '@nextlyhq/adapter-sqlite';
 *
 * const adapter = createSqliteAdapter({
 *   url: 'file:./data/app.db',
 * });
 *
 * await adapter.connect();
 *
 * // Query data
 * const users = await adapter.select('users', {
 *   where: { and: [{ column: 'status', op: '=', value: 'active' }] },
 *   limit: 10,
 * });
 *
 * await adapter.disconnect();
 * ```
 *
 * @packageDocumentation
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
// F17: connect-time DB version check shared across all adapters.
import {
  createDatabaseError,
  isDatabaseError,
  type SqliteAdapterConfig,
  type DatabaseCapabilities,
  type PoolStats,
  type TransactionContext,
  type TransactionOptions,
  type SqlParam,
  type WhereClause,
  type WhereCondition,
  type WhereOperator,
  type SelectOptions,
  type InsertOptions,
  type UpdateOptions,
  type DeleteOptions,
  type UpsertOptions,
  type OrderBySpec,
  type JoinSpec,
  type DatabaseError,
  type DatabaseErrorKind,
  type BaseAdapterConfig,
  type AdapterLogger,
  isApplicationError,
} from "@nextlyhq/adapter-drizzle/types";
import { checkDialectVersion } from "@nextlyhq/adapter-drizzle/version-check";
import type Database from "better-sqlite3";
import type { AnyRelations, SQL } from "drizzle-orm";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";

// Re-export types for convenience
export type {
  SqliteAdapterConfig,
  DatabaseCapabilities,
  PoolStats,
  TransactionContext,
  TransactionOptions,
  SqlParam,
  WhereClause,
  WhereCondition,
  WhereOperator,
  SelectOptions,
  InsertOptions,
  UpdateOptions,
  DeleteOptions,
  UpsertOptions,
  OrderBySpec,
  JoinSpec,
  DatabaseError,
  DatabaseErrorKind,
  BaseAdapterConfig,
  AdapterLogger,
};

/**
 * Package version
 */
export const VERSION = "0.1.0";

/**
 * SQLite error codes mapping to DatabaseErrorKind.
 *
 * @see https://sqlite.org/rescode.html
 */
const SQLITE_ERROR_CODES: Record<string, DatabaseErrorKind> = {
  // Constraint violations
  SQLITE_CONSTRAINT: "constraint",
  SQLITE_CONSTRAINT_UNIQUE: "unique_violation",
  SQLITE_CONSTRAINT_PRIMARYKEY: "unique_violation",
  SQLITE_CONSTRAINT_FOREIGNKEY: "foreign_key_violation",
  SQLITE_CONSTRAINT_NOTNULL: "not_null_violation",
  SQLITE_CONSTRAINT_CHECK: "check_violation",

  // Busy/locked errors
  SQLITE_BUSY: "timeout",
  SQLITE_LOCKED: "timeout",

  // Connection errors
  SQLITE_CANTOPEN: "connection",
  SQLITE_NOTADB: "connection",
  SQLITE_CORRUPT: "connection",

  // Query errors
  SQLITE_ERROR: "query",
  SQLITE_MISUSE: "query",
  SQLITE_RANGE: "query",
};

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG = {
  busyTimeout: 5000,
  wal: true,
  foreignKeys: true,
};

/**
 * Converts a JavaScript value to a type that better-sqlite3 can bind.
 * better-sqlite3 only accepts: number, string, bigint, Buffer, null.
 *
 * These conversions have to match what the schema declares, because the rows
 * they write are read back through it. Every column here that takes a `Date`
 * is `integer({ mode: "timestamp" })` — the system columns and user date
 * fields in `runtime-schema-generator.ts`, and the core tables, whose date
 * columns are all INTEGER. So a date is bound as unix seconds, which is what
 * that mode reads.
 */
function sanitizeSqliteValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  // Binary is bound as binary: better-sqlite3 takes a Buffer or a typed
  // array for a BLOB as it is, and the object branch below would spell it
  // out as JSON text instead.
  if (Buffer.isBuffer(v) || ArrayBuffer.isView(v)) return v;
  // Seconds, not an ISO string. SQLite stores whatever it is given regardless
  // of the declared type, so a string lands in the column without complaint
  // and only fails on the way back out, where the timestamp decoder reads it
  // as a number and yields an Invalid Date.
  if (v instanceof Date) return Math.floor(v.getTime() / 1000);
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return v;
}

/**
 * SQLite database adapter for Nextly.
 *
 * Extends the base DrizzleAdapter to provide SQLite-specific functionality
 * using the better-sqlite3 package.
 *
 * @remarks
 * SQLite has some differences from PostgreSQL:
 * - Synchronous API (wrapped for async compatibility)
 * - No connection pooling (single file/connection)
 * - RETURNING clause supported (SQLite 3.35+)
 * - Savepoints supported via nested transactions
 * - No native ILIKE (uses LOWER() LIKE workaround)
 * - JSON support (not JSONB)
 * - No array types
 *
 * @example
 * ```typescript
 * const adapter = new SqliteAdapter({
 *   url: 'file:./data.db',
 * });
 *
 * await adapter.connect();
 * ```
 */
export class SqliteAdapter extends DrizzleAdapter {
  // getDrizzle memoization: drizzle v1's constructor builds a relational
  // query builder per table in the relations config (~40 tables), and the
  // service layer resolves an instance on every db access — construct once
  // per relations object (identity-stable: the schema registry caches it
  // and hands out a NEW object on invalidation, which naturally misses
  // this cache and produces a fresh instance).
  private drizzleByRelations = new WeakMap<AnyRelations, unknown>();
  private drizzleBare: unknown;

  /**
   * The database dialect - always 'sqlite' for this adapter.
   */
  readonly dialect = "sqlite" as const;

  /**
   * Adapter configuration.
   */
  protected readonly config: SqliteAdapterConfig;

  /**
   * better-sqlite3 Database instance.
   */
  private db: Database.Database | null = null;

  /**
   * Connection state flag.
   */
  private connected = false;

  /**
   * Serialization queue for concurrent `transaction()` calls.
   *
   * better-sqlite3 is synchronous, single-connection, and rejects nested
   * `BEGIN` with "cannot start a transaction within a transaction".
   * When two `await adapter.transaction(...)` calls overlap (e.g. a bulk
   * mutation calling `Promise.allSettled` with N per-row updates), the
   * second one tries to BEGIN while the first is still open and the
   * driver throws.
   *
   * Postgres/MySQL avoid this by allocating a fresh client/connection
   * per transaction from a pool — there is no equivalent for
   * better-sqlite3, so we serialize at the JS layer instead. Every
   * `transaction()` invocation chains onto this promise; only one
   * BEGIN→COMMIT/ROLLBACK section runs at any moment, preserving
   * write-isolation semantics that callers expect from a transactional
   * adapter.
   *
   * Performance impact is the natural floor: SQLite already serializes
   * writers at the file-lock level, so the queue removes failed-call
   * surface area without changing the achievable concurrency.
   */
  private transactionQueue: Promise<unknown> = Promise.resolve();

  /**
   * The transaction the current async chain is running inside, if any.
   *
   * A `transaction()` call made from INSIDE a transaction's work — a store
   * writing on behalf of the caller, a plugin's write inside its own
   * `ctx.db.transaction` — used to queue behind the very transaction that
   * was waiting for it, and neither ever settled: that hung every later
   * transaction on the instance too. Such a call now runs as a SAVEPOINT of
   * the active transaction instead, so it commits or rolls back with it and
   * its own failure undoes only its own part.
   */
  private readonly transactionScope = new AsyncLocalStorage<TransactionScope>();

  /**
   * Creates a new SQLite adapter instance.
   *
   * @param config - Adapter configuration
   */
  constructor(config: SqliteAdapterConfig) {
    super();
    this.config = config;
  }

  /**
   * Connect to the SQLite database.
   *
   * @remarks
   * This method initializes the database connection. For SQLite, this
   * opens the database file or creates an in-memory database.
   * Also configures WAL mode and foreign keys based on config.
   *
   * @throws {DatabaseError} If connection fails
   */
  async connect(): Promise<void> {
    if (this.connected && this.db) {
      return;
    }

    try {
      // Dynamic import of better-sqlite3 to avoid bundling issues
      const BetterSqlite3 = await import("better-sqlite3");
      const Database = BetterSqlite3.default;

      // Determine database path
      let dbPath: string;
      if (this.config.memory) {
        dbPath = ":memory:";
      } else if (this.config.url) {
        // Strip file: prefix if present
        dbPath = this.config.url.replace(/^file:/, "");
      } else {
        dbPath = ":memory:";
      }

      // Ensure the parent directory exists for file-backed databases.
      // better-sqlite3 fails with a confusing "Cannot open database
      // because the directory does not exist" error if it doesn't, and
      // a fresh clone with `DATABASE_URL=file:./data/app.db` reliably
      // hits this on first run. Create the dir lazily so DATABASE_URL
      // can point anywhere without a separate setup step.
      if (dbPath !== ":memory:" && !this.config.readonly) {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const dir = path.dirname(path.resolve(dbPath));
        await fs.promises.mkdir(dir, { recursive: true });
      }

      // Create database instance
      this.db = new Database(dbPath, {
        readonly: this.config.readonly ?? false,
        timeout: this.config.busyTimeout ?? DEFAULT_CONFIG.busyTimeout,
      });

      // Configure WAL mode for better concurrency (unless in-memory or readonly)
      if (
        (this.config.wal ?? DEFAULT_CONFIG.wal) &&
        dbPath !== ":memory:" &&
        !this.config.readonly
      ) {
        this.db.pragma("journal_mode = WAL");
      }

      // Enable foreign keys
      if (this.config.foreignKeys ?? DEFAULT_CONFIG.foreignKeys) {
        this.db.pragma("foreign_keys = ON");
      }

      // F17: check SQLite version. Hard-fails on SQLite <3.38. SQLite has
      // no recognized cloud variants we warn on, so onWarning is omitted.
      // Note: better-sqlite3's bundled SQLite is set by the package
      // version; users on this package's pinned better-sqlite3 (3.45+)
      // will always pass.
      await checkDialectVersion(this.db, "sqlite");

      this.connected = true;

      if (this.config.logger?.info) {
        this.config.logger.info("SQLite connection established", {
          url: dbPath === ":memory:" ? "in-memory" : dbPath,
          wal: this.config.wal ?? DEFAULT_CONFIG.wal,
          foreignKeys: this.config.foreignKeys ?? DEFAULT_CONFIG.foreignKeys,
        });
      }
    } catch (error) {
      // Clean up on failure
      if (this.db) {
        try {
          this.db.close();
        } catch {
          // Ignore close errors during error handling
        }
        this.db = null;
      }
      throw this.classifyError(error);
    }
  }

  /**
   * Disconnect from the SQLite database.
   *
   * @remarks
   * This method closes the database connection and releases resources.
   */
  // better-sqlite3 is synchronous; method is async to satisfy the DatabaseAdapter contract.
  // eslint-disable-next-line @typescript-eslint/require-await
  async disconnect(): Promise<void> {
    // Drop memoized drizzle instances — they wrap the connection being
    // closed and must not survive a reconnect.
    this.drizzleBare = undefined;
    this.drizzleByRelations = new WeakMap();
    if (!this.db) {
      return;
    }

    try {
      this.db.close();

      if (this.config.logger?.info) {
        this.config.logger.info("SQLite connection closed");
      }
    } finally {
      this.db = null;
      this.connected = false;
    }
  }

  /**
   * Check if connected to the database.
   */
  isConnected(): boolean {
    return this.connected && this.db !== null;
  }

  /**
   * Get connection pool statistics.
   *
   * @remarks
   * SQLite doesn't use connection pooling, so this returns null.
   * The database is single-file with a single connection.
   */
  getPoolStats(): PoolStats | null {
    // SQLite doesn't have connection pooling
    return null;
  }

  /**
   * Execute a raw SQL query.
   *
   * @param sql - SQL query string with $1, $2 placeholders (converted to ? for SQLite)
   * @param params - Query parameters
   * @returns Query results
   *
   * @throws {DatabaseError} If query execution fails
   */
  // better-sqlite3 is synchronous; method is async to satisfy the DatabaseAdapter contract.
  // eslint-disable-next-line @typescript-eslint/require-await
  async executeQuery<T = unknown>(
    sql: string,
    params: SqlParam[] = []
  ): Promise<T[]> {
    const db = this.ensureDb();
    const startTime = Date.now();

    try {
      // Convert $1, $2 placeholders to ? for better-sqlite3
      const convertedSql = this.convertPlaceholders(sql);

      // Determine if this is a SELECT query or a modifying query
      const trimmedSql = convertedSql.trim().toUpperCase();

      // Check for PRAGMA query statements (e.g., "PRAGMA foreign_keys").
      // Setting PRAGMAs (e.g., "PRAGMA foreign_keys = OFF") don't return data.
      const isPragmaQuery =
        trimmedSql.startsWith("PRAGMA") && !trimmedSql.includes("=");

      const isSelect =
        trimmedSql.startsWith("SELECT") ||
        isPragmaQuery ||
        trimmedSql.startsWith("WITH");
      const hasReturning = trimmedSql.includes("RETURNING");

      let result: T[];

      const sanitizedParams = params.map(sanitizeSqliteValue);

      if (isSelect || hasReturning) {
        // Use .all() for SELECT queries or queries with RETURNING
        const stmt = db.prepare(convertedSql);
        result = stmt.all(...sanitizedParams) as T[];
      } else {
        // Use .run() for INSERT/UPDATE/DELETE/PRAGMA settings without RETURNING
        const stmt = db.prepare(convertedSql);
        const runResult = stmt.run(...sanitizedParams);
        // Return info about the operation
        result = [
          {
            changes: runResult.changes,
            lastInsertRowid: runResult.lastInsertRowid,
          } as unknown as T,
        ];
      }

      // Log query if logger configured
      if (this.config.logger?.query) {
        const durationMs = Date.now() - startTime;
        this.config.logger.query(convertedSql, params, durationMs);
      }

      return result;
    } catch (error) {
      throw this.classifyError(error, sql);
    }
  }

  /**
   * Execute work within a transaction.
   *
   * @param work - Function containing transactional operations
   * @param options - Transaction options (isolation level not fully supported in SQLite)
   * @returns Result of the work function
   *
   * @remarks
   * The adapter manages the transaction itself, because better-sqlite3's
   * `db.transaction()` does not take async work: it runs `BEGIN IMMEDIATE`,
   * then `COMMIT` when `work` resolves or `ROLLBACK` when it throws.
   * - Top-level calls run one at a time.
   * - A call made inside an open transaction's work joins it as a savepoint
   *   (`SAVEPOINT` / `RELEASE` / `ROLLBACK TO`).
   * - Nested calls of one scope run one at a time.
   * - A call made later from a savepoint that has already released joins the
   *   innermost scope still open.
   * - Nested work started and not awaited finishes before the enclosing scope
   *   commits or rolls back.
   *
   * Note: SQLite uses DEFERRED, IMMEDIATE, or EXCLUSIVE transaction modes
   * rather than isolation levels. This adapter uses IMMEDIATE.
   */
  async transaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
    _options?: TransactionOptions
  ): Promise<T> {
    // Why: serialize concurrent transaction() invocations to dodge
    // SQLite's "cannot start a transaction within a transaction"
    // error when two awaits overlap on the same connection. See the
    // `transactionQueue` field comment for the full rationale. The queue
    // chains every call onto a tail promise so only one BEGIN → COMMIT
    // section runs at a time; the next call's BEGIN waits for the
    // previous COMMIT/ROLLBACK to finish.
    //
    // Failure isolation: the queue's tail promise must not reject (a
    // rejection would poison every subsequent transaction with the same
    // rejected value). We attach a no-op `.catch` so the chain stays
    // resolved while the actual error propagates back to the original
    // caller through the inner promise.
    // A call made inside an open transaction's work joins it as a savepoint;
    // see `nestingScope` for which scope it joins.
    const own = this.transactionScope.getStore();
    const parent = this.nestingScope();
    // Called from a scope that has closed: what this writes is no longer that
    // scope's to undo.
    if (own && parent !== own) own.writesAfterClosing += 1;
    if (parent) {
      // Nested calls of one scope are serialized among themselves too: two
      // interleaved savepoints would release or roll back each other.
      return enqueueIn(parent, () => this.runSavepoint(work, parent));
    }
    const run = async (): Promise<Committed<T>> => this.runTransaction(work);
    const next = this.transactionQueue.then(run, run);
    this.transactionQueue = next.catch(() => undefined);
    const { result, effects } = await next;
    // After the queue has moved on rather than inside it: an effect that opens
    // a transaction of its own would otherwise wait behind the one running it.
    await this.runHeldEffects(effects);
    return result;
  }

  /**
   * Hold `effect` until the transaction enclosing this async context commits,
   * or run it now when none does.
   *
   * The effect belongs to the scope this async context runs in, even one
   * that has already released or rolled back: a service whose own
   * transaction nested as a savepoint registers from its caller's scope once
   * that savepoint has released, and the change is undoable for as long as
   * any scope around it is. The outermost transaction runs the effect once
   * its COMMIT succeeds, unless a scope between the effect's scope and the
   * outermost transaction rolled back, and drops every effect on ROLLBACK or
   * a failed COMMIT. A context whose outermost transaction has already
   * finished is outside any transaction, so its effect runs now, unless what
   * it announces was undone and it has run no transaction since.
   */
  override async afterCommit(
    effect: () => unknown,
    onDeferredFailure?: (error: unknown) => void
  ): Promise<void> {
    const scope = this.transactionScope.getStore();
    if (!scope) {
      await effect();
      return;
    }
    const root = outermost(scope);
    if (!root.finished) {
      root.held.push({
        effect,
        onDeferredFailure,
        scope,
        writesBefore: scope.writesAfterClosing,
      });
      return;
    }
    if (!undone(scope, scope.writesAfterClosing)) await effect();
  }

  /**
   * Run the effects a committed transaction held, in order. A failure is
   * reported, never thrown: the change is durable, and reporting the
   * transaction as failed would invite a retry of something already done.
   */
  private async runHeldEffects(effects: HeldEffect[]): Promise<void> {
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
    const failure = error instanceof Error ? error : new Error(String(error));
    if (this.config.logger?.error) {
      this.config.logger.error(failure, { phase: "after-commit" });
    } else {
      console.error("An effect held until commit failed:", failure);
    }
  }

  /**
   * Whether a `transaction()` call made here would join an open transaction
   * as a savepoint. On SQLite it would: the connection is the only one, so a
   * transaction open on it encloses whatever the async chain that opened it
   * starts.
   */
  override inTransaction(): boolean {
    return this.nestingScope() !== undefined;
  }

  /**
   * The scope a `transaction()` call made here nests in, or none when it
   * opens a transaction of its own.
   *
   * A call made later from inside a savepoint that has since released runs
   * inside the innermost scope open on the connection. Queued on an enclosing
   * scope, or on the instance, it would wait behind the scope running there,
   * which may be the one awaiting it. Savepoints on one connection form a
   * stack, so whatever opens now is inside that innermost scope anyway; when
   * none is open the call queues on the instance.
   *
   * The innermost open scope need not be related to the call. When it is a
   * sibling savepoint that later rolls back, the call's write rolls back with
   * it, although the call itself already resolved. Waiting for an unrelated
   * scope instead could wait on the very scope that awaits the call.
   */
  private nestingScope(): TransactionScope | undefined {
    const own = this.transactionScope.getStore();
    return own?.active ? own : own?.open.at(-1);
  }

  /**
   * Run `work` as a savepoint of the active transaction: released when it
   * resolves, rolled back to when it throws.
   */
  private async runSavepoint<T>(
    work: (tx: TransactionContext) => Promise<T>,
    parent: TransactionScope
  ): Promise<T> {
    const db = this.ensureDb();
    const depth = parent.depth + 1;
    const name = `nextly_sp_${depth}`;
    try {
      const ctx = this.createTransactionContext(db);
      db.exec(`SAVEPOINT ${name}`);
      // Open only once the savepoint exists, so a failed SAVEPOINT leaves no
      // scope behind for a later call to nest in.
      const scope = openScope(parent);
      try {
        const result = await this.transactionScope.run(scope, () => work(ctx));
        await settleNested(scope);
        db.exec(`RELEASE ${name}`);
        return result;
      } catch (error) {
        // Nested work this savepoint started and did not wait for is part of
        // it: let it finish first, so the rollback discards its writes rather
        // than leaving it to run afterwards on the enclosing transaction.
        await settleNested(scope);
        // Its change is undone, so nothing registered from it, before or
        // after this point, may announce it.
        scope.rolledBack = true;
        try {
          db.exec(`ROLLBACK TO ${name}`);
          db.exec(`RELEASE ${name}`);
        } catch {
          // The enclosing transaction may already have ended.
        }
        throw error;
      }
    } catch (error) {
      if (isApplicationError(error)) throw error;
      throw this.classifyError(error);
    }
  }

  /**
   * Inner transaction body. Kept private so callers always go through
   * the serialized `transaction()` queue above and the BEGIN/COMMIT
   * pair is never invoked outside of it.
   */
  private async runTransaction<T>(
    work: (tx: TransactionContext) => Promise<T>
  ): Promise<Committed<T>> {
    const db = this.ensureDb();
    const startTime = Date.now();

    try {
      // Create transaction context
      const ctx = this.createTransactionContext(db);

      // Since better-sqlite3's db.transaction() doesn't support async functions,
      // we manually manage the transaction with BEGIN/COMMIT/ROLLBACK
      db.exec("BEGIN IMMEDIATE");

      // The scope nested `transaction()` calls from this work join.
      const scope = openScope();
      try {
        const result = await this.transactionScope.run(scope, () => work(ctx));
        // Anything the work started and did not wait for is part of this
        // transaction, so it finishes before the commit rather than after.
        await settleNested(scope);
        db.exec("COMMIT");
        scope.finished = true;

        // Log success
        if (this.config.logger?.debug) {
          const durationMs = Date.now() - startTime;
          this.config.logger.debug("Transaction committed", {
            durationMs,
          });
        }

        return {
          result,
          effects: scope.held.filter(
            held => !undone(held.scope, held.writesBefore)
          ),
        };
      } catch (error) {
        // As on commit: queued nested work finishes inside the transaction,
        // so the rollback discards it instead of it running in autocommit.
        await settleNested(scope);
        // Rolled back, or a COMMIT that failed: the effects held for this
        // transaction describe a change that did not happen.
        scope.rolledBack = true;
        scope.finished = true;
        scope.held.length = 0;
        // Rollback on error
        try {
          db.exec("ROLLBACK");
        } catch {
          // Ignore rollback errors - transaction may already be aborted
        }
        throw error;
      }
    } catch (error) {
      // Work inside a transaction may throw to roll the write back — a refused
      // value, a denied permission — and that is the application's verdict, not
      // the driver's failure. Classifying it would replace its code and payload
      // with a generic database error, so a caller that asked for a refusal is
      // handed an unexplained failure and the per-field detail never arrives.
      if (isApplicationError(error)) throw error;
      throw this.classifyError(error);
    }
  }

  /**
   * Get SQLite database capabilities.
   *
   * @remarks
   * SQLite capabilities:
   * - JSON support (not JSONB)
   * - No arrays
   * - No native ILIKE
   * - RETURNING clause (3.35+)
   * - Savepoints supported
   * - ON CONFLICT supported
   */
  getCapabilities(): DatabaseCapabilities {
    return {
      dialect: "sqlite",
      supportsJsonb: false, // SQLite uses JSON, not JSONB
      supportsJson: true,
      supportsArrays: false, // SQLite doesn't support array types
      supportsGeneratedColumns: true, // SQLite 3.31+
      supportsFts: true, // SQLite FTS5
      supportsIlike: false, // No native ILIKE, use LOWER() LIKE
      supportsReturning: true, // SQLite 3.35+
      supportsSavepoints: true, // SQLite supports savepoints
      supportsOnConflict: true, // ON CONFLICT clause
      maxParamsPerQuery: 999, // SQLite SQLITE_MAX_VARIABLE_NUMBER default
      maxIdentifierLength: 128, // SQLite doesn't have a strict limit
    };
  }

  /**
   * Override insertMany for bulk insert optimization.
   *
   * @remarks
   * Uses a single multi-row INSERT statement for better performance.
   */
  override async insertMany<T = unknown>(
    table: string,
    data: Record<string, unknown>[],
    options?: InsertOptions
  ): Promise<T[]> {
    if (data.length === 0) {
      return [];
    }

    const db = this.ensureDb();

    // For single record, use parent implementation
    if (data.length === 1) {
      const result = await this.insert<T>(table, data[0], options);
      return [result];
    }

    // Build multi-row INSERT
    const columns = Object.keys(data[0]);
    const params: SqlParam[] = [];
    const valuesClauses: string[] = [];

    for (const record of data) {
      const placeholders: string[] = [];
      for (const col of columns) {
        params.push(sanitizeSqliteValue(record[col]) as SqlParam);
        placeholders.push("?");
      }
      valuesClauses.push(`(${placeholders.join(", ")})`);
    }

    const columnList = columns
      .map(col => this.escapeIdentifier(col))
      .join(", ");
    let sql = `INSERT INTO ${this.escapeIdentifier(table)} (${columnList}) VALUES ${valuesClauses.join(", ")}`;

    // Add RETURNING clause
    if (options?.returning) {
      const returning =
        options.returning === "*"
          ? "*"
          : options.returning.map(col => this.escapeIdentifier(col)).join(", ");
      sql += ` RETURNING ${returning}`;
    } else {
      sql += " RETURNING *";
    }

    try {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...(params as unknown[])) as T[];
      // SQLite stores a timestamp as an integer and hands it back as one. The
      // Drizzle read paths decode it through the column definition, so without
      // this a bulk insert answers with numbers where a read answers `Date`.
      const tableObj = this.getTableObject(table);
      return rows.map(r => this.mapRowFromRawSql(tableObj, r));
    } catch (error) {
      throw this.handleQueryError(error, "insertMany", table);
    }
  }

  // ============================================================
  // Protected Helper Methods
  // ============================================================

  /**
   * Ensures database is connected and returns it.
   *
   * @throws {DatabaseError} If not connected
   */
  private ensureDb(): Database.Database {
    if (!this.db) {
      throw createDatabaseError({
        kind: "connection",
        message: "SqliteAdapter is not connected. Call connect() first.",
      });
    }
    return this.db;
  }

  /**
   * Return the typed Drizzle instance for SQLite.
   * Guarded for server-only usage and requires an active connection.
   *
   * @param schema - Optional schema for relational queries (db.query.*)
   * @returns Drizzle ORM instance wrapping the better-sqlite3 connection
   * @throws {Error} If called in browser or not connected
   */
  getDrizzle<T = BetterSQLite3Database<AnyRelations>>(
    relations?: AnyRelations
  ): T {
    if (typeof window !== "undefined") {
      throw new Error("getDrizzle() is server-only");
    }
    const db = this.ensureDb();
    // drizzle v1 removed the positional (client, config) form — positional
    // calls silently open a NEW :memory: database. Object form only.
    if (!relations) {
      this.drizzleBare ??= drizzle({ client: db });
      return this.drizzleBare as T;
    }
    let cached = this.drizzleByRelations.get(relations);
    if (!cached) {
      cached = drizzle({ client: db, relations });
      this.drizzleByRelations.set(relations, cached);
    }
    return cached as T;
  }

  /**
   * Convert $1, $2 placeholders to ? for better-sqlite3.
   *
   * @param sql - SQL with PostgreSQL-style placeholders
   * @returns SQL with ? placeholders
   */
  private convertPlaceholders(sql: string): string {
    // Replace $1, $2, etc. with ?
    return sql.replace(/\$\d+/g, "?");
  }

  /**
   * Creates a TransactionContext for the given database connection.
   */
  /** A table-level `primaryKey({ columns })`, read through the SQLite table config. */
  protected override compositePrimaryKey(
    tableObj: Record<string, unknown>
  ): object[] {
    return getTableConfig(
      tableObj as unknown as SQLiteTable
    ).primaryKeys.flatMap(key => key.columns);
  }

  private createTransactionContext(db: Database.Database): TransactionContext {
    // better-sqlite3 is synchronous; the methods below are async to satisfy
    // the TransactionContext contract shared with truly-async dialect adapters.
    // Bind a Drizzle instance to the transaction's connection so the delegated
    // CRUD methods run inside it. better-sqlite3 is single-connection, so this
    // is the same connection getDrizzle() would use, but binding explicitly
    // keeps the three adapters consistent and correct if that ever changes.
    // Built lazily and memoized: transactions that use only raw execute/insert
    // never construct it.
    const txHandles = this.transactionDrizzleHandles(() =>
      drizzle({ client: db })
    );
    const txDb = txHandles.bare;
    return {
      ...txHandles.context,

      // SQLite has no row-level locking and needs none here: `withTransaction`
      // opens SQLite transactions with BEGIN IMMEDIATE, which takes the write
      // lock up front and serializes writers for the whole transaction.
      lockRow: (): Promise<void> => Promise.resolve(),

      // `run`, not `all`: better-sqlite3 throws on a statement that returns no
      // rows, which is every statement this method exists to carry. The Drizzle
      // instance is the transaction-bound one, so the statement runs inside this
      // transaction.
      //
      // better-sqlite3 is synchronous, so this resolves an already-settled
      // promise rather than being declared `async` over a body that never
      // awaits.
      runStatement: (statement: SQL): Promise<void> => {
        txDb().run(statement);
        return Promise.resolve();
      },

      // `all`, not `run`: this is the reading half, and better-sqlite3 returns
      // rows only from `all`. Synchronous, so the promise is already settled.
      queryStatement: <T = Record<string, unknown>>(
        statement: SQL
      ): Promise<T[]> => Promise.resolve(txDb().all(statement)),

      // eslint-disable-next-line @typescript-eslint/require-await
      execute: async <T = unknown>(
        sql: string,
        params: SqlParam[] = []
      ): Promise<T[]> => {
        const convertedSql = this.convertPlaceholders(sql);
        const trimmedSql = convertedSql.trim().toUpperCase();
        const isSelect =
          trimmedSql.startsWith("SELECT") || trimmedSql.includes("RETURNING");
        const sanitizedParams = params.map(sanitizeSqliteValue);

        if (isSelect) {
          const stmt = db.prepare(convertedSql);
          return stmt.all(...sanitizedParams) as T[];
        } else {
          const stmt = db.prepare(convertedSql);
          const result = stmt.run(...sanitizedParams);
          return [
            {
              changes: result.changes,
              lastInsertRowid: result.lastInsertRowid,
            } as unknown as T,
          ];
        }
      },

      // Keys only, unlike the PostgreSQL and MySQL raw paths, which also encode
      // their date values. `sanitizeSqliteValue` below binds a `Date` as unix
      // seconds, and an instant carries no zone -- so what SQLite stores does
      // not depend on the server's timezone and there is nothing to correct.
      // eslint-disable-next-line @typescript-eslint/require-await
      insert: async <T = unknown>(
        table: string,
        data: Record<string, unknown>,
        options?: InsertOptions
      ): Promise<T> => {
        const mapped = this.mapKeysToSqlColumns(
          this.getTableObject(table),
          data
        );
        const columns = Object.keys(mapped);
        const values = Object.values(mapped).map(sanitizeSqliteValue);
        const placeholders = values.map(() => "?").join(", ");

        let sql = `INSERT INTO ${this.escapeIdentifier(table)} (${columns.map(c => this.escapeIdentifier(c)).join(", ")}) VALUES (${placeholders})`;

        const ret = options?.returning;
        const returningEmpty = Array.isArray(ret) && ret.length === 0;
        if (!returningEmpty) {
          const returning =
            !ret || ret === "*"
              ? "*"
              : this.mapColumnNamesToSql(this.getTableObject(table), ret)
                  .map(col => this.escapeIdentifier(col))
                  .join(", ");
          sql += ` RETURNING ${returning}`;
        }

        const stmt = db.prepare(sql);
        if (returningEmpty) {
          // No RETURNING clause: better-sqlite3's .all() rejects a statement
          // that returns no columns, so run it and return nothing.
          stmt.run(...values);
          return undefined as T;
        }
        const rows = stmt.all(...values) as T[];
        // Return JS property-named keys AND Drizzle-decoded date values, so a
        // write inside a transaction answers with the same representation a
        // read of the same row gives.
        return this.mapRowFromRawSql(this.getTableObject(table), rows[0]);
      },

      // eslint-disable-next-line @typescript-eslint/require-await
      insertMany: async <T = unknown>(
        table: string,
        data: Record<string, unknown>[],
        options?: InsertOptions
      ): Promise<T[]> => {
        if (data.length === 0) return [];

        const tableObj = this.getTableObject(table);
        const mappedRecords = data.map(r =>
          this.mapKeysToSqlColumns(tableObj, r)
        );
        const columns = Object.keys(mappedRecords[0]);
        const allValues: unknown[] = [];
        const valuesClauses: string[] = [];

        for (const record of mappedRecords) {
          const placeholders: string[] = [];
          for (const col of columns) {
            allValues.push(sanitizeSqliteValue(record[col]));
            placeholders.push("?");
          }
          valuesClauses.push(`(${placeholders.join(", ")})`);
        }

        let sql = `INSERT INTO ${this.escapeIdentifier(table)} (${columns.map(c => this.escapeIdentifier(c)).join(", ")}) VALUES ${valuesClauses.join(", ")}`;

        const ret = options?.returning;
        const returningEmpty = Array.isArray(ret) && ret.length === 0;
        if (!returningEmpty) {
          const returning =
            !ret || ret === "*"
              ? "*"
              : this.mapColumnNamesToSql(this.getTableObject(table), ret)
                  .map(col => this.escapeIdentifier(col))
                  .join(", ");
          sql += ` RETURNING ${returning}`;
        }

        const stmt = db.prepare(sql);
        if (returningEmpty) {
          stmt.run(...allValues);
          return [];
        }
        return (stmt.all(...allValues) as T[]).map(r =>
          this.mapRowFromRawSql(tableObj, r)
        );
      },

      // Adapter-built, as `insert` above is; `transactionUpdate` says why.
      // A column the model does not declare binds as every other value on
      // this path does, through `sanitizeSqliteValue`. `all` only when the
      // statement carries RETURNING: better-sqlite3 throws on `all` for a
      // statement that returns no rows, and on `run` for one that does.
      update: this.transactionUpdate(
        txDb,
        (statement, returnsRows) =>
          returnsRows
            ? txDb().all<Record<string, unknown>>(statement)
            : (txDb().run(statement), undefined),
        sanitizeSqliteValue
      ),

      ...this.createTransactionForwarders(txDb),

      // eslint-disable-next-line @typescript-eslint/require-await
      savepoint: async (name: string): Promise<void> => {
        db.exec(`SAVEPOINT ${this.escapeIdentifier(name)}`);
      },

      // eslint-disable-next-line @typescript-eslint/require-await
      rollbackToSavepoint: async (name: string): Promise<void> => {
        db.exec(`ROLLBACK TO SAVEPOINT ${this.escapeIdentifier(name)}`);
      },

      // eslint-disable-next-line @typescript-eslint/require-await
      releaseSavepoint: async (name: string): Promise<void> => {
        db.exec(`RELEASE SAVEPOINT ${this.escapeIdentifier(name)}`);
      },
    };
  }

  /**
   * Classifies a SQLite error into a DatabaseError.
   *
   * @param error - Original error from better-sqlite3
   * @param sql - SQL statement that caused the error (optional)
   * @returns DatabaseError with proper classification
   */
  // fallow-ignore-next-line complexity
  protected override classifyError(
    error: unknown,
    sql?: string
  ): DatabaseError {
    // Why short-circuit on existing DatabaseError: F17's
    // UnsupportedDialectVersionError is already a typed DatabaseError with
    // kind: "unsupported_version" plus detectedVersion/requiredVersion
    // fields. Re-wrapping it here would erase those fields.
    if (isDatabaseError(error)) return error;

    // Classify from the DRIVER's error, which is not necessarily the one handed
    // in. A query failure arrives wrapped: DrizzleQueryError carries the SQL
    // statement as its message and no code, and better-sqlite3's own error —
    // the only object that knows what actually went wrong — sits below it in
    // the `cause` chain. Classifying the wrapper means classifying the QUERY
    // TEXT, which reported a unique violation on a table with a `locked_by`
    // column as a "timeout", because the statement contains the word LOCKED.
    const sqliteError = findDriverError(error);

    // Determine error kind from SQLite error code
    let kind: DatabaseErrorKind = "unknown";

    if (sqliteError.code) {
      kind = SQLITE_ERROR_CODES[sqliteError.code] || "unknown";
    } else if (sqliteError.message) {
      // Try to extract error type from message. Safe to match loosely now:
      // `sqliteError` is the driver's error, so its message is the driver's
      // description of the failure and never a SQL statement.
      const msg = sqliteError.message.toUpperCase();
      if (msg.includes("UNIQUE CONSTRAINT")) {
        kind = "unique_violation";
      } else if (msg.includes("FOREIGN KEY CONSTRAINT")) {
        kind = "foreign_key_violation";
      } else if (msg.includes("NOT NULL CONSTRAINT")) {
        kind = "not_null_violation";
      } else if (msg.includes("CHECK CONSTRAINT")) {
        kind = "check_violation";
      } else if (msg.includes("BUSY") || msg.includes("LOCKED")) {
        kind = "timeout";
      } else if (
        msg.includes("SQLITE_CANTOPEN") ||
        msg.includes("UNABLE TO OPEN")
      ) {
        kind = "connection";
      }
    }

    // Build error message from the driver's description, for the same reason
    // the classification uses it: the wrapper's message is the SQL statement.
    let message = sqliteError.message ?? String(error);
    if (sql && kind === "query") {
      message = `Query failed: ${message}`;
    }

    return createDatabaseError({
      kind,
      message,
      code: sqliteError.code,
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/** The fields this classifier reads off an error, at any depth in the chain. */
interface DriverErrorShape {
  code?: string;
  message?: string;
  name?: string;
  cause?: unknown;
}

/**
 * The deepest error in the `cause` chain that carries a SQLite error code, or
 * the outermost error when none does.
 *
 * better-sqlite3 sets `code` (`SQLITE_CONSTRAINT_UNIQUE`, `SQLITE_BUSY`, ...);
 * the wrappers around it do not. Walking to the code is therefore walking to
 * the only object that knows what failed. The walk is depth-bounded rather than
 * unbounded because an error chain can be made cyclic, and a classifier that
 * can hang is worse than one that occasionally gives up.
 *
 * Falls back to the outermost error so a driver error that genuinely carries no
 * code — one constructed from a message alone — still classifies exactly as it
 * did before.
 */
function findDriverError(error: unknown): DriverErrorShape {
  let cursor = error as DriverErrorShape | null | undefined;
  for (let depth = 0; depth < 10 && cursor != null; depth++) {
    if (typeof cursor.code === "string" && cursor.code.length > 0)
      return cursor;
    cursor = cursor.cause as DriverErrorShape | null | undefined;
  }
  return error ?? {};
}

/**
 * Create a SQLite database adapter.
 *
 * @param config - SQLite adapter configuration
 * @returns A new SqliteAdapter instance
 *
 * @example
 * ```typescript
 * // Simple usage with file path
 * const adapter = createSqliteAdapter({
 *   url: 'file:./data.db',
 * });
 *
 * // In-memory database
 * const memAdapter = createSqliteAdapter({
 *   memory: true,
 * });
 *
 * // Full configuration
 * const adapter = createSqliteAdapter({
 *   url: 'file:./data.db',
 *   wal: true,
 *   foreignKeys: true,
 *   busyTimeout: 5000,
 *   logger: {
 *     query: (sql, params, duration) => console.log(`Query: ${sql}`),
 *   },
 * });
 *
 * await adapter.connect();
 * ```
 */
export function createSqliteAdapter(
  config: SqliteAdapterConfig
): SqliteAdapter {
  return new SqliteAdapter(config);
}

/**
 * Type guard to check if a value is a SqliteAdapter.
 *
 * @param value - Value to check
 * @returns True if value is a SqliteAdapter instance
 *
 * @example
 * ```typescript
 * if (isSqliteAdapter(adapter)) {
 *   // TypeScript knows adapter is SqliteAdapter
 *   console.log('Using SQLite');
 * }
 * ```
 */
export function isSqliteAdapter(value: unknown): value is SqliteAdapter {
  return value instanceof SqliteAdapter;
}

/** One active transaction, as the calls nested inside it see it. */
interface TransactionScope {
  /** False once the transaction has finished, or is finishing. */
  active: boolean;
  /** 0 for the transaction itself; each savepoint is one deeper. */
  depth: number;
  /** The scope this savepoint was opened in; none for the transaction. */
  parent?: TransactionScope;
  /** True once this savepoint, or this outermost transaction, rolled back. */
  rolledBack: boolean;
  /**
   * How many `transaction()` calls this scope's context has made since it
   * closed, each running somewhere else: an effect registered after one of
   * them may announce a write this scope's rollback did not undo.
   */
  writesAfterClosing: number;
  /** True once this outermost transaction has committed or rolled back. */
  finished: boolean;
  /**
   * Effects registered with `afterCommit` from any scope of the outermost
   * transaction, in order. Only the outermost transaction's list is used.
   */
  held: HeldEffect[];
  /** Serializes the calls nested directly inside this transaction. */
  queue: Promise<unknown>;
  /**
   * The scopes open on this connection, outermost first, shared by the
   * transaction and every savepoint inside it. Each scope runs inside the
   * one before it: a scope runs one nested call at a time, so the scopes
   * still running form a single chain and the last one open is the innermost.
   */
  open: TransactionScope[];
}

/** An `afterCommit` effect waiting for the outermost transaction to commit. */
interface HeldEffect {
  effect: () => unknown;
  onDeferredFailure?: (error: unknown) => void;
  /** The scope it was registered from; it is dropped if that one is undone. */
  scope: TransactionScope;
  /** `scope.writesAfterClosing` when it was registered. */
  writesBefore: number;
}

/** What a committed transaction hands back: its result and its held effects. */
interface Committed<T> {
  result: T;
  effects: HeldEffect[];
}

/**
 * Open the scope of a savepoint inside `parent`, or of an outermost
 * transaction when there is none, and record it among the connection's open
 * scopes.
 */
function openScope(parent?: TransactionScope): TransactionScope {
  const scope: TransactionScope = {
    active: true,
    depth: parent ? parent.depth + 1 : 0,
    parent,
    rolledBack: false,
    writesAfterClosing: 0,
    finished: false,
    held: [],
    queue: Promise.resolve(),
    open: parent ? parent.open : [],
  };
  scope.open.push(scope);
  return scope;
}

/** The outermost transaction `scope` runs inside; itself for that one. */
function outermost(scope: TransactionScope): TransactionScope {
  let at = scope;
  while (at.parent) at = at.parent;
  return at;
}

/**
 * Whether an effect registered from `scope` describes a write that was
 * undone: `scope`, or a scope it runs inside, rolled back, and no
 * transaction had run from its context since it closed when the effect was
 * registered (`writesBefore`). An effect registered before such a write
 * still describes the undone one.
 */
function undone(scope: TransactionScope, writesBefore: number): boolean {
  if (writesBefore > 0) return false;
  for (let at: TransactionScope | undefined = scope; at; at = at.parent) {
    if (at.rolledBack) return true;
  }
  return false;
}

/** Chain `run` onto a scope's queue, keeping the queue itself unrejected. */
function enqueueIn<T>(
  scope: TransactionScope,
  run: () => Promise<T>
): Promise<T> {
  const next = scope.queue.then(run, run);
  scope.queue = next.catch(() => undefined);
  return next;
}

/**
 * Close a scope to new nested calls and wait for those already queued. A call
 * arriving after this joins the innermost scope still open on the connection,
 * or, when none is, goes to the instance queue behind the transaction.
 */
async function settleNested(scope: TransactionScope): Promise<void> {
  scope.active = false;
  // A failed RELEASE or COMMIT settles the same scope a second time.
  const index = scope.open.indexOf(scope);
  if (index !== -1) scope.open.splice(index, 1);
  await scope.queue;
}
