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

import { asc, desc, getTableColumns } from "drizzle-orm";

import { buildDrizzleWhere } from "./drizzle-where";
import type {
  SupportedDialect,
  SqlParam,
  WhereClause,
  OrderBySpec,
  SelectOptions,
  InsertOptions,
  UpdateOptions,
  DeleteOptions,
  UpsertOptions,
  TransactionContext,
  TransactionOptions,
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
import { createDatabaseError, isDatabaseError } from "./types";

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
   * @param callback - Function to execute within transaction
   * @param options - Transaction options
   * @returns Result from the callback
   *
   * @throws {DatabaseError} If transaction fails
   */
  abstract transaction<T>(
    callback: (ctx: TransactionContext) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T>;

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
   * @param schema - Optional schema object for typed queries
   * @returns Raw Drizzle ORM database instance
   *
   * @example
   * ```typescript
   * // For legacy code that needs direct Drizzle access
   * const db = adapter.getDrizzle(mySchemas);
   * const result = await db.insert(users).values({ ... }).returning();
   * ```
   */
  abstract getDrizzle<T = unknown>(schema?: Record<string, unknown>): T;

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
   * string building. Falls back to raw SQL if the resolver doesn't have the table.
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

      // Detect JSON/JSONB columns — Drizzle auto-serializes objects for these,
      // so pre-stringified values must be parsed to avoid double-encoding.
      const dataType = (colDef as { dataType?: string }).dataType;
      const columnType = (colDef as { columnType?: string }).columnType;
      // Detect JSON/JSONB columns — Drizzle auto-serializes objects for these,
      // so pre-stringified values must be parsed to avoid double-encoding.
      // IMPORTANT: For SQLite, only match text columns declared with { mode: "json" }
      // (columnType "SQLiteTextJson", dataType "json"). Plain SQLiteText columns
      // (dataType "string") store pre-serialized strings and must NOT be re-parsed,
      // otherwise better-sqlite3 receives objects it cannot bind.
      if (
        dataType === "json" ||
        columnType === "PgJsonb" ||
        columnType === "PgJson" ||
        columnType === "MySqlJson" ||
        columnType === "SQLiteTextJson" // SQLite JSON-mode text columns only
      ) {
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
    options?: SelectOptions
  ): Promise<T[]> {
    // Drizzle query API path: use when table resolver has a Drizzle table object
    const tableObj = this.getTableObject(table);
    if (tableObj) {
      try {
        // getDrizzle() returns unknown - explicit any generic for dialect-specific Drizzle API
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = this.getDrizzle<any>();
        let query = db.select().from(tableObj);

        if (options?.where) {
          const whereCondition = buildDrizzleWhere(
            tableObj as never,
            options.where
          );
          if (whereCondition) {
            query = query.where(whereCondition);
          }
        }

        if (options?.orderBy?.length) {
          const columns = getTableColumns(tableObj as never);
          const orderClauses = options.orderBy
            .map((o: OrderBySpec) => {
              const col = columns[o.column];
              if (!col) return undefined;
              return o.direction === "desc" ? desc(col) : asc(col);
            })
            .filter(Boolean);
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

        return (await query) as T[];
      } catch (error) {
        throw this.handleQueryError(error, "select", table);
      }
    }

    // Table not found in schema registry - cannot use Drizzle query API
    throw this.createDatabaseError(
      "query",
      `Table "${table}" not found in schema registry. Ensure setTableResolver() has been called during boot.`,
      undefined
    );
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
  async selectOne<T = unknown>(
    table: string,
    options?: SelectOptions
  ): Promise<T | null> {
    const results = await this.select<T>(table, { ...options, limit: 1 });
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

        if (caps.supportsReturning && options?.returning) {
          const result = await db
            .insert(tableObj)
            .values(mappedData)
            .returning();
          return (Array.isArray(result) ? result[0] : result) as T;
        }

        const result = await db.insert(tableObj).values(mappedData);

        // For databases without RETURNING (MySQL): select back the inserted record
        if (!caps.supportsReturning && options?.returning) {
          if (data.id !== undefined) {
            return (await this.selectOne<T>(table, {
              where: {
                and: [{ column: "id", op: "=", value: data.id as SqlParam }],
              },
            })) as T;
          }
        }

        return (Array.isArray(result) ? result[0] : result) as T;
      } catch (error) {
        throw this.handleQueryError(error, "insert", table);
      }
    }

    throw this.createDatabaseError(
      "query",
      `Table "${table}" not found in schema registry. Ensure setTableResolver() has been called during boot.`,
      undefined
    );
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
    options?: UpdateOptions
  ): Promise<T[]> {
    // Drizzle query API path
    const tableObj = this.getTableObject(table);
    if (tableObj) {
      try {
        // getDrizzle() returns unknown - explicit any generic for dialect-specific Drizzle API
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = this.getDrizzle<any>();
        const caps = this.getCapabilities();
        // Map snake_case keys to Drizzle JS property names
        const mappedData = this.mapDataToColumnNames(tableObj, data);
        let query = db.update(tableObj).set(mappedData);

        const whereCondition = buildDrizzleWhere(tableObj as never, where);
        if (whereCondition) {
          query = query.where(whereCondition);
        }

        if (caps.supportsReturning && options?.returning) {
          return (await query.returning()) as T[];
        }

        await query;

        // For databases without RETURNING: select back the updated records
        if (!caps.supportsReturning && options?.returning) {
          return await this.select<T>(table, { where });
        }

        return [] as T[];
      } catch (error) {
        throw this.handleQueryError(error, "update", table);
      }
    }

    throw this.createDatabaseError(
      "query",
      `Table "${table}" not found in schema registry. Ensure setTableResolver() has been called during boot.`,
      undefined
    );
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
    _options?: DeleteOptions
  ): Promise<number> {
    // Drizzle query API path
    const tableObj = this.getTableObject(table);
    if (tableObj) {
      try {
        // getDrizzle() returns unknown - explicit any generic for dialect-specific Drizzle API
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = this.getDrizzle<any>();
        let query = db.delete(tableObj);

        const whereCondition = buildDrizzleWhere(tableObj as never, where);
        if (whereCondition) {
          query = query.where(whereCondition);
        }

        const result = await query;
        // Drizzle returns different shapes per dialect
        return Array.isArray(result)
          ? result.length
          : (((result as Record<string, unknown>)?.rowCount as number) ??
              ((result as Record<string, unknown>)?.changes as number) ??
              0);
      } catch (error) {
        throw this.handleQueryError(error, "delete", table);
      }
    }

    throw this.createDatabaseError(
      "query",
      `Table "${table}" not found in schema registry. Ensure setTableResolver() has been called during boot.`,
      undefined
    );
  }

  /**
   * Upsert (INSERT or UPDATE) a record.
   *
   * @remarks
   * Default implementation uses dialect-specific ON CONFLICT syntax.
   * PostgreSQL/SQLite: ON CONFLICT ... DO UPDATE
   * MySQL: ON DUPLICATE KEY UPDATE
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
    options: UpsertOptions
  ): Promise<T> {
    // Drizzle query API path
    const tableObj = this.getTableObject(table);
    if (tableObj) {
      try {
        // getDrizzle() returns unknown - explicit any generic for dialect-specific Drizzle API
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = this.getDrizzle<any>();
        const caps = this.getCapabilities();
        const columns = getTableColumns(tableObj as never);

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

        let query;
        if (caps.supportsOnConflict) {
          // PostgreSQL/SQLite: ON CONFLICT DO UPDATE
          query = db.insert(tableObj).values(data).onConflictDoUpdate({
            target: conflictTarget,
            set: updateData,
          });
        } else {
          // MySQL: fallback to insert, catch duplicate key, then update
          // This is handled by the MySQL adapter override
          query = db.insert(tableObj).values(data);
        }

        if (caps.supportsReturning) {
          const result = await query.returning();
          return (Array.isArray(result) ? result[0] : result) as T;
        }

        await query;

        // For databases without RETURNING: select back using conflict columns
        if (
          options.conflictColumns.length &&
          data[options.conflictColumns[0]] !== undefined
        ) {
          return (await this.selectOne<T>(table, {
            where: {
              and: [
                {
                  column: options.conflictColumns[0],
                  op: "=",
                  value: data[options.conflictColumns[0]] as SqlParam,
                },
              ],
            },
          })) as T;
        }

        return data as T;
      } catch (error) {
        throw this.handleQueryError(error, "upsert", table);
      }
    }

    throw this.createDatabaseError(
      "query",
      `Table "${table}" not found in schema registry. Ensure setTableResolver() has been called during boot.`,
      undefined
    );
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
        const defaultVal =
          typeof col.default === "object" &&
          col.default !== null &&
          "sql" in col.default
            ? col.default.sql
            : typeof col.default === "string"
              ? `'${col.default}'`
              : String(col.default);
        colSql += ` DEFAULT ${defaultVal}`;
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
    try {
      let sql: string;
      const params: SqlParam[] = [];

      switch (this.dialect) {
        case "postgresql":
          sql = `
            SELECT EXISTS (
              SELECT FROM information_schema.tables
              WHERE table_schema = $1
              AND table_name = $2
            ) as exists
          `;
          params.push(schema ?? "public", tableName);
          break;

        case "mysql":
          sql = `
            SELECT COUNT(*) as count
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
            AND table_name = ?
          `;
          params.push(tableName);
          break;

        case "sqlite":
          sql = `
            SELECT COUNT(*) as count
            FROM sqlite_master
            WHERE type = 'table'
            AND name = ?
          `;
          params.push(tableName);
          break;

        default:
          throw this.createDatabaseError(
            "query",
            `tableExists not implemented for dialect: ${String(this.dialect)}`,
            undefined
          );
      }

      const results = await this.executeQuery<Record<string, unknown>>(
        sql,
        params
      );

      if (results.length === 0) {
        return false;
      }

      const row = results[0];

      // PostgreSQL returns { exists: true/false }
      if ("exists" in row) {
        return row.exists === true || row.exists === "t" || row.exists === 1;
      }

      // MySQL/SQLite return { count: number }
      if ("count" in row) {
        return Number(row.count) > 0;
      }

      return false;
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
          sql = `
            SELECT table_name
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

      const results = await this.executeQuery<{ table_name: string }>(
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
   * Handle query errors and convert to DatabaseError.
   *
   * @remarks
   * Protected helper for consistent error handling across CRUD operations.
   * Subclasses can override to add dialect-specific error classification.
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
    if (isDatabaseError(error)) {
      return error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    return this.createDatabaseError(
      "query",
      `${operation} operation failed on table '${table}': ${errorMessage}`,
      error instanceof Error ? error : undefined
    );
  }
}
