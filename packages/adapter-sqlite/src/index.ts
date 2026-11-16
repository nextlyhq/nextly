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

import { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { isNextBuildPhase } from "@nextlyhq/adapter-drizzle/build-phase";
// F17: connect-time DB version check shared across all adapters.
import {
  createDatabaseError,
  isDatabaseError,
  poolWaitTimeoutError,
  type SqliteAdapterConfig,
  type ConnectionInspection,
  type DatabaseCapabilities,
  type PoolStats,
  type TransactionContext,
  type TransactionOptions,
  type SessionOptions,
  type StatementSession,
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
import {
  getTableConfig,
  integer,
  sqliteTable,
  type SQLiteTable,
} from "drizzle-orm/sqlite-core";

import { registerSqliteFunctions } from "./sql-functions";

/**
 * A date field's column as the schema generator declares it on SQLite:
 * `integer` in timestamp mode. Its encoder writes unix seconds, which is what
 * a `Date` bound to an undeclared key is spelled as.
 */
const DATE_FIELD_COLUMN = sqliteTable("nextly_date_field", {
  at: integer("at", { mode: "timestamp" }),
}).at;

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
  // How long a transaction waits for the connection, behind the ones before
  // it: the same bound, and the same default, as a pooled connection's wait
  // on the PostgreSQL and MySQL adapters.
  connectionTimeoutMs: 15000,
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
 * - No native ILIKE (both sides case-folded, then LIKE; the fold is Nextly's own
 *   `nextly_fold_case`, registered on connect, since SQLite's `lower()` folds ASCII only)
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
      //
      // Not in `next build`, which writes nothing to the database: there a
      // file that is not there yet is a database nobody has migrated, and
      // opening it would create it. The build refuses instead, naming the
      // command that sets it up, and opens an existing file as it is.
      const building = isNextBuildPhase();
      if (building && dbPath !== ":memory:") {
        const fs = await import("node:fs");
        if (!fs.existsSync(dbPath)) {
          throw createDatabaseError({
            kind: "connection",
            message:
              `The SQLite database file ${dbPath} does not exist. ` +
              "Run `nextly migrate` before `next build`.",
          });
        }
      } else if (dbPath !== ":memory:" && !this.config.readonly) {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const dir = path.dirname(path.resolve(dbPath));
        await fs.promises.mkdir(dir, { recursive: true });
      }

      // Create database instance
      this.db = new Database(dbPath, {
        readonly: this.config.readonly ?? false,
        fileMustExist: building,
        timeout: this.config.busyTimeout ?? DEFAULT_CONFIG.busyTimeout,
      });

      // Before anything runs on the connection: the case fold the text matches that ignore
      // case call here, whose absence would refuse every such statement.
      registerSqliteFunctions(this.db);

      // Configure WAL mode for better concurrency (unless in-memory or
      // readonly). Not in `next build`: the journal mode is kept in the file,
      // so setting it is a write, and the first start after the build sets it.
      if (
        (this.config.wal ?? DEFAULT_CONFIG.wal) &&
        dbPath !== ":memory:" &&
        !this.config.readonly &&
        !building
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
   * The connection as a health check reads it: a file on this machine, with
   * no network connection to encrypt, and the library's version, timed for
   * the round trip. A read that fails leaves the version and time out.
   */
  // better-sqlite3 is synchronous: the answer is read at once and handed back
  // as the base class's promise.
  override inspectConnection(): Promise<ConnectionInspection> {
    const inspection: ConnectionInspection = {
      encryption: "not-applicable",
      local: true,
    };
    if (!this.db) return Promise.resolve(inspection);
    try {
      const started = performance.now();
      const row = this.db
        .prepare("SELECT sqlite_version() AS version")
        .get() as { version?: unknown } | undefined;
      const roundTripMs = Math.max(0, Math.round(performance.now() - started));
      return Promise.resolve({
        ...inspection,
        roundTripMs,
        ...(typeof row?.version === "string" && row.version !== ""
          ? { serverVersion: row.version }
          : {}),
      });
    } catch {
      return Promise.resolve(inspection);
    }
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

  /** How long a transaction waits for the connection: `pool.connectionTimeoutMs`. */
  private transactionWaitMs(): number {
    return (
      this.config.pool?.connectionTimeoutMs ??
      DEFAULT_CONFIG.connectionTimeoutMs
    );
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
  transaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
    options?: TransactionOptions
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
    // see `joinableFrame` for which frame it joins.
    // Nested calls of one frame are serialized among themselves too
    // (`runJoined`): two interleaved savepoints would release or roll back
    // each other.
    return this.openOrJoin(work, options, {
      // After the queue has moved on rather than inside it, the base runs
      // what the transaction held: an effect that opens a transaction of its
      // own would otherwise wait behind the one running it.
      run: () => this.takeTurn(() => this.runTransaction(work, options)),
      // SQLite raises no serialization failure: an attempt is tried again
      // only when `retryWhen` accepts the error that ended it.
      retryable: () => false,
      describe: () => ({ label: "a retryable error", detail: {} }),
      logger: this.config.logger,
    });
  }

  /**
   * Runs `work` outside a transaction, each statement committing as it runs,
   * once no other flow's transaction is open on the one connection.
   *
   * @remarks
   * Waits its turn in `transactionQueue` as a transaction does: a statement
   * run while another flow's transaction is open would join it, and be undone
   * if it rolled back. Transactions begun meanwhile wait behind the session in
   * turn, so `work` must not open one of its own: it would wait behind the
   * session that waits for it, until it fails as busy.
   */
  override async withSession<T>(
    work: (session: StatementSession) => Promise<T>,
    _options?: SessionOptions
  ): Promise<T> {
    // A precondition: before the session takes its turn.
    this.refuseSessionInTransaction();
    return this.takeTurn(() =>
      work({
        execute: <R = unknown>(statement: string, params?: SqlParam[]) =>
          this.executeQuery<R>(statement, params),
      })
    );
  }

  /**
   * Runs `run` once every turn queued before it in `transactionQueue` is
   * done, and holds the queue until `run` is done too.
   */
  private takeTurn<R>(run: () => Promise<R>): Promise<R> {
    const previous = this.transactionQueue;
    // The one connection is this queue's to hand out, so its wait is the
    // wait `pool.connectionTimeoutMs` bounds on the other dialects: past it,
    // the turn fails as busy without having begun.
    const next = waitForTurn(previous, this.transactionWaitMs()).then(run);
    // The queue moves on once the turn before this one AND this one are
    // done. One that gave up waiting never ran, and the next must still wait
    // for the one it gave up on, or it would begin inside it.
    this.transactionQueue = previous.then(() => next).catch(() => undefined);
    return next;
  }

  /** A held effect's failure that no reporter took goes to the adapter's logger. */
  protected override logHeldEffectFailure(failure: Error): void {
    if (this.config.logger?.error) {
      this.config.logger.error(failure, { phase: "after-commit" });
    } else {
      super.logHeldEffectFailure(failure);
    }
  }

  /**
   * The statements of a savepoint `depth` deep on the one connection:
   * released when its work resolves, rolled back to when it throws.
   */
  private savepointSteps(depth: number) {
    const db = this.ensureDb();
    const name = `nextly_sp_${depth}`;
    return {
      context: this.createTransactionContext(db),
      begin: () => {
        db.exec(`SAVEPOINT ${name}`);
      },
      commit: () => {
        db.exec(`RELEASE ${name}`);
      },
      rollback: () => {
        db.exec(`ROLLBACK TO ${name}`);
        db.exec(`RELEASE ${name}`);
      },
    };
  }

  /**
   * One attempt's transaction body, settled rather than rejected for the
   * transaction's own failure (`runOutermost`). Kept private so callers always
   * go through the serialized `transaction()` queue above and the
   * BEGIN/COMMIT pair is never invoked outside of it.
   */
  private async runTransaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
    options: TransactionOptions | undefined
  ) {
    const db = this.ensureDb();

    try {
      // Since better-sqlite3's db.transaction() doesn't support async functions,
      // we manually manage the transaction with BEGIN/COMMIT/ROLLBACK
      return await this.settleOutermost(
        {
          context: this.createTransactionContext(db),
          // A call made inside the transaction joins it as a savepoint.
          join: { adapter: depth => this.savepointSteps(depth) },
          begin: () => {
            db.exec("BEGIN IMMEDIATE");
          },
          commit: () => {
            db.exec("COMMIT");
          },
          // SQLite may already have rolled the transaction back itself; the
          // ROLLBACK is unconfirmed only when the connection is still in one.
          rollback: () => {
            try {
              db.exec("ROLLBACK");
            } catch (error) {
              if (db.inTransaction) throw error;
            }
          },
        },
        work,
        options
      );
    } catch (error) {
      // Building the transaction's context failed before it began: as
      // `transaction()` reports an attempt's failure.
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
      supportsIlike: false, // No native ILIKE: both sides case-folded, then LIKE
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

    // Refused as the single-row insert is: a table this instance never
    // registered may not match what its code would write.
    const tableObj = this.resolvedTableObject(table);

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
  /** A `Date` on an undeclared key is spelled as a date field's column spells it. */
  protected override undeclaredDateColumn(): {
    mapToDriverValue(value: unknown): unknown;
  } {
    return DATE_FIELD_COLUMN;
  }

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
    const txHandles = this.transactionDrizzleHandles(relations =>
      relations ? drizzle({ client: db, relations }) : drizzle({ client: db })
    );
    const txDb = txHandles.bare;
    return {
      drizzleWithRelations: txHandles.withRelations,

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

      execute: async <T = unknown>(
        sql: string,
        params: SqlParam[] = []
        // eslint-disable-next-line @typescript-eslint/require-await -- async so a synchronous throw becomes a rejection
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
      insert: async <T = unknown>(
        table: string,
        data: Record<string, unknown>,
        options?: InsertOptions
        // eslint-disable-next-line @typescript-eslint/require-await -- async so a synchronous throw becomes a rejection
      ): Promise<T> => {
        // Refused before any statement, as the pooled insert is: a table this
        // instance never registered may not match what its code would write.
        const tableObj = this.resolvedTableObject(table);
        const mapped = this.mapKeysToSqlColumns(tableObj, data);
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
              : this.mapColumnNamesToSql(tableObj, ret)
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
        return this.mapRowFromRawSql(tableObj, rows[0]);
      },

      insertMany: async <T = unknown>(
        table: string,
        data: Record<string, unknown>[],
        options?: InsertOptions
        // eslint-disable-next-line @typescript-eslint/require-await -- async so a synchronous throw becomes a rejection
      ): Promise<T[]> => {
        if (data.length === 0) return [];

        // Refused before any statement, as `insert` above is.
        const tableObj = this.resolvedTableObject(table);
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
              : this.mapColumnNamesToSql(tableObj, ret)
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
      // this path does, through `sanitizeSqliteValue`, with a `Date` spelled
      // first as a date field's column spells it, as the insert's is. `all`
      // only when the statement carries RETURNING: better-sqlite3 throws on
      // `all` for a statement that returns no rows, and on `run` for one that
      // does.
      update: this.transactionUpdate(
        txDb,
        (statement, returnsRows) =>
          returnsRows
            ? txDb().all<Record<string, unknown>>(statement)
            : (txDb().run(statement), undefined),
        value => sanitizeSqliteValue(this.encodeUndeclaredDate(value))
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
    const sqliteError = this.driverErrorIn<DriverErrorShape>(
      error,
      candidate => typeof candidate.code === "string" && candidate.code !== ""
    );

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

/**
 * Settles once `turn` does, or rejects with the pool-wait timeout error once
 * `boundMs` passes first. A bound of 0 waits without limit, as pg-pool reads a
 * `connectionTimeoutMillis` of 0.
 */
function waitForTurn(turn: Promise<unknown>, boundMs: number): Promise<void> {
  if (boundMs <= 0) return turn.then(() => undefined);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(poolWaitTimeoutError(boundMs)),
      boundMs
    );
    // A pending wait never keeps the process alive on its own.
    timer.unref();
    void turn.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
