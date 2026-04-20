import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type {
  WhereClause,
  SqlParam,
  DatabaseCapabilities,
} from "@revnixhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { getDialectTables } from "../database/index";

import { normalizeDbTimestamp } from "./lib/date-formatting";
import type { Logger } from "./types";
import type { DatabaseAdapter } from "./types/database-adapter";

// SQL fragments used by BaseService.withTransaction's SQLite branch.
// Declared at module scope (not per-call) so we don't allocate a fresh
// sql template literal on every transaction. `sql.raw` is the documented
// Drizzle way to inject unparameterized SQL for DDL/DCL statements.
const sqliteBeginImmediate = sql.raw("BEGIN IMMEDIATE");
const sqliteCommit = sql.raw("COMMIT");
const sqliteRollback = sql.raw("ROLLBACK");

/**
 * Base class for all Nextly services providing adapter-based database access.
 *
 * This class encapsulates the database adapter pattern, enabling services to work
 * seamlessly across PostgreSQL, MySQL, and SQLite without database-specific code.
 * All services should extend this class to gain consistent database access patterns,
 * transaction management, and helper utilities.
 *
 * ## Key Features
 *
 * - **Database Abstraction**: Services use adapter interface, not direct Drizzle
 * - **Transaction Management**: Built-in transaction wrapper with proper typing
 * - **Query Helpers**: Convenient methods for building WHERE clauses
 * - **Capability Detection**: Check database-specific feature support
 * - **Logging**: Integrated logger for all database operations
 *
 * ## Architecture
 *
 * Services depend on the `DrizzleAdapter` interface, which automatically selects
 * the correct database adapter (PostgreSQL, MySQL, or SQLite) based on environment
 * configuration. This enables:
 *
 * 1. **Multi-database support** - Same service code works across all databases
 * 2. **Tree-shaking** - Only the used adapter is bundled
 * 3. **Type safety** - Full TypeScript support with no `any` casts
 * 4. **Testability** - Easy to mock adapter for unit tests
 *
 * ## Usage Example
 *
 * ```typescript
 * import { BaseService } from './base-service';
 * import type { DrizzleAdapter } from '@revnixhq/adapter-drizzle';
 * import type { Logger } from './shared';
 *
 * export class UserService extends BaseService {
 *   constructor(adapter: DrizzleAdapter, logger: Logger) {
 *     super(adapter, logger);
 *   }
 *
 *   async findUserById(id: string): Promise<User> {
 *     // Access dialect for conditional logic
 *     if (this.dialect === 'postgresql') {
 *       // PostgreSQL-specific optimization
 *     }
 *
 *     // Use adapter for queries
 *     const user = await this.adapter.selectOne<User>('users', {
 *       where: this.whereEq('id', id),
 *     });
 *
 *     if (!user) {
 *       throw new Error('User not found');
 *     }
 *
 *     return user;
 *   }
 *
 *   async updateUser(id: string, data: Partial<User>): Promise<User> {
 *     // Use transaction wrapper
 *     return this.withTransaction(async (tx) => {
 *       const [updated] = await tx.update<User>(
 *         'users',
 *         data,
 *         this.whereEq('id', id),
 *         { returning: '*' }
 *       );
 *       return updated;
 *     });
 *   }
 *
 *   async searchUsers(email: string): Promise<User[]> {
 *     // Check capability before using ILIKE
 *     if (this.supportsFeature('supportsIlike')) {
 *       return this.adapter.select<User>('users', {
 *         where: { and: [{ column: 'email', op: 'ILIKE', value: `%${email}%` }] },
 *       });
 *     } else {
 *       // Fallback for MySQL/SQLite (uses LOWER() LIKE)
 *       return this.adapter.select<User>('users', {
 *         where: { and: [{ column: 'email', op: 'LIKE', value: `%${email.toLowerCase()}%` }] },
 *       });
 *     }
 *   }
 * }
 * ```
 *
 * ## Migration from Legacy BaseService
 *
 * If migrating from the old BaseService that accepted `db` and `tables`:
 *
 * **Before:**
 * ```typescript
 * class UserService extends BaseService<DatabaseInstance, Tables> {
 *   constructor(db: DatabaseInstance, tables: Tables) {
 *     super(db, tables);
 *   }
 *
 *   async findById(id: string): Promise<User> {
 *     const [user] = await this.db
 *       .select()
 *       .from(this.tables.users)
 *       .where(eq(this.tables.users.id, id))
 *       .limit(1);
 *     return user;
 *   }
 * }
 * ```
 *
 * **After:**
 * ```typescript
 * import { users } from '../database/schema'; // Import schema separately
 *
 * class UserService extends BaseService {
 *   constructor(adapter: DrizzleAdapter, logger: Logger) {
 *     super(adapter, logger);
 *   }
 *
 *   async findById(id: string): Promise<User> {
 *     const user = await this.adapter.selectOne<User>('users', {
 *       where: this.whereEq('id', id),
 *     });
 *     return user;
 *   }
 * }
 * ```
 *
 * @see {@link DrizzleAdapter} - Core adapter interface
 * @see {@link TransactionContext} - Transaction context methods
 * @see {@link WhereClause} - WHERE clause structure
 * @see {@link DatabaseCapabilities} - Database feature flags
 */
export abstract class BaseService<
  TAdapter extends DatabaseAdapter = DatabaseAdapter,
> {
  private _db: TAdapter["db"] | null = null;
  private _tables: TAdapter["tables"] | null = null;

  constructor(
    protected readonly adapter: DrizzleAdapter,
    protected readonly logger: Logger
  ) {}

  /**
   * Raw Drizzle instance for relational queries (.query.TABLE.findFirst(), etc.).
   * Prefer this.adapter methods for simple CRUD; use this.db only when you need
   * Drizzle's query builder directly (JOINs, relational queries, aggregations).
   *
   * Schema is passed to getDrizzle() so that the relational query API
   * (db.query.users.findFirst, etc.) has access to table definitions.
   * Cached after first access.
   */
  protected get db(): TAdapter["db"] {
    if (!this._db) {
      this._db = this.adapter.getDrizzle<TAdapter["db"]>(
        this.tables as Record<string, unknown>
      );
    }
    return this._db;
  }

  /**
   * Dialect-specific table schemas resolved from the current adapter.
   * Cached after first access.
   */
  protected get tables(): TAdapter["tables"] {
    if (!this._tables) {
      this._tables = getDialectTables(
        this.adapter.getCapabilities().dialect
      ) as TAdapter["tables"];
    }
    return this._tables;
  }

  /**
   * Get the current database dialect.
   *
   * Use this property for conditional logic when you need database-specific behavior.
   * However, prefer using the adapter's built-in dialect handling when possible.
   *
   * @returns The database dialect: 'postgresql', 'mysql', or 'sqlite'
   *
   * @example
   * ```typescript
   * // Check dialect for conditional logic
   * if (this.dialect === 'postgresql') {
   *   // Use PostgreSQL-specific optimization
   *   await this.adapter.execute('SELECT ... FOR UPDATE SKIP LOCKED');
   * } else {
   *   // Fallback for other databases
   *   await this.adapter.select('users', { where: ... });
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Log dialect for debugging
   * this.logger.info(`Running query on ${this.dialect} database`);
   * ```
   */
  protected get dialect() {
    return this.adapter.getCapabilities().dialect;
  }

  /**
   * Execute work within a database transaction using Drizzle ORM's fluent API.
   *
   * Transactions ensure ACID properties (Atomicity, Consistency, Isolation, Durability)
   * across multiple database operations. If the callback throws, all changes are rolled
   * back. If it returns, the transaction commits.
   *
   * The `tx` argument is a Drizzle instance that exposes the fluent query API
   * (`tx.insert(table).values(data)`, `tx.update(table).set(data).where(cond)`, etc.).
   * On PostgreSQL and MySQL this is a dialect-specific Drizzle transaction object
   * (`NodePgTransaction` / `MySql2Transaction`). On SQLite it is the shared `this.db`
   * instance, because better-sqlite3's native transaction API cannot run async callbacks
   * — see the SQLite branch below for why.
   *
   * ## Transaction Behavior by Dialect
   *
   * - **PostgreSQL** — routes through Drizzle's native `db.transaction(fn)`. Supports
   *   savepoints, isolation levels, and fully async callbacks. tx is a real
   *   `NodePgTransaction`.
   * - **MySQL** — same as PostgreSQL via `MySql2Transaction`.
   * - **SQLite** — better-sqlite3's `db.transaction()` rejects any callback that returns
   *   a promise (`TypeError: Transaction function cannot return a promise`). Since
   *   every Nextly service method is async, we cannot use Drizzle's native SQLite
   *   transaction. Instead we open the transaction manually via `BEGIN IMMEDIATE`
   *   on the shared connection, run the callback against `this.db`, and COMMIT or
   *   ROLLBACK on success/failure. All Drizzle queries against `this.db` during the
   *   callback window execute on the same synchronous connection and therefore
   *   participate in the BEGIN/COMMIT boundary.
   *
   * ## Why not the adapter's positional `TransactionContext`
   *
   * The adapter's `TransactionContext` (`tx.insert(table: string, data: object)`)
   * builds raw SQL strings internally. Drizzle's fluent API uses the same
   * parameterized query builder as the rest of the codebase, gives schema-based
   * type safety, and is the pattern Task 1 (db-adapters refactor) standardized on.
   * The positional adapter context is only kept for legacy collection-service code
   * paths that have not yet been migrated.
   *
   * @param work - Async function executed inside the transaction. Receives a
   *   Drizzle instance (transaction on PG/MySQL, shared db on SQLite) as `tx`.
   * @returns Promise resolving to the function's return value.
   *
   * @throws {DatabaseError} If the transaction fails or is rolled back.
   *
   * @example Basic insert + insert atomic
   * ```typescript
   * async createUserWithProfile(userData: NewUser, profileData: NewProfile): Promise<User> {
   *   return this.withTransaction(async (tx: any) => {
   *     const [user] = await tx.insert(this.tables.users).values(userData).returning();
   *     await tx.insert(this.tables.profiles).values({ ...profileData, userId: user.id });
   *     return user;
   *   });
   * }
   * ```
   *
   * @example Update with rollback on validation failure
   * ```typescript
   * async transferCredits(fromId: string, toId: string, amount: number): Promise<void> {
   *   await this.withTransaction(async (tx: any) => {
   *     await tx.update(this.tables.users)
   *       .set({ credits: sql`${this.tables.users.credits} - ${amount}` })
   *       .where(eq(this.tables.users.id, fromId));
   *
   *     await tx.update(this.tables.users)
   *       .set({ credits: sql`${this.tables.users.credits} + ${amount}` })
   *       .where(eq(this.tables.users.id, toId));
   *
   *     const [sender] = await tx.select().from(this.tables.users)
   *       .where(eq(this.tables.users.id, fromId));
   *
   *     if (sender.credits < 0) {
   *       // Throwing rolls back BOTH updates atomically.
   *       throw new Error('Insufficient credits');
   *     }
   *   });
   * }
   * ```
   */
  // The tx argument is dialect-typed (NodePgTransaction / MySql2Transaction /
  // BetterSQLite3Database). Importing all three would bind BaseService to all
  // three driver packages and break tree-shaking, so we use `unknown` here and
  // callers narrow with `(tx: any)` if they need fluent chaining. The fluent
  // query API surface is identical across all three so most callers don't need
  // a cast beyond that.
  protected async withTransaction<T>(
    work: (tx: unknown) => Promise<T>
  ): Promise<T> {
    // SQLite's better-sqlite3 driver is synchronous. Drizzle's
    // sqlite-core `db.transaction(fn)` explicitly rejects async callbacks
    // with `TypeError: Transaction function cannot return a promise`. Every
    // Nextly service method is async (hooks, permission checks, email
    // dispatch, etc.), so we can never use Drizzle's native SQLite
    // transaction wrapper.
    //
    // Fall back to a manual BEGIN IMMEDIATE / COMMIT / ROLLBACK on the
    // shared connection. We pass `this.db` as the `tx` argument — it is the
    // same Drizzle instance `BaseService.db` exposes, which means queries
    // against it during the callback window run on the exact same
    // synchronous better-sqlite3 connection and therefore participate in
    // the BEGIN/COMMIT boundary. On the happy path we COMMIT; on thrown
    // error we ROLLBACK and re-throw so the caller observes the same
    // rollback semantics as the PG/MySQL branch.
    if (this.dialect === "sqlite") {
      // Drizzle's better-sqlite3 instance exposes `.run(sql`...`)` for raw
      // SQL execution. Use a template literal with the `sql` helper so the
      // SQL is statically typed and escaped identically to regular queries.
      // We import `sql` lazily via `this.db.$client` — actually better to
      // use drizzle-orm's re-export below.
      await this.db.run(sqliteBeginImmediate);
      try {
        const result = await work(this.db);
        await this.db.run(sqliteCommit);
        return result;
      } catch (err) {
        try {
          await this.db.run(sqliteRollback);
        } catch {
          // Ignore rollback errors — the transaction may already be
          // aborted if the underlying error was a constraint violation,
          // and we always want to surface the original error to the
          // caller.
        }
        throw err;
      }
    }
    // PG/MySQL: Drizzle's native transaction API supports async callbacks
    // and binds the callback's `tx` to a pooled client that automatically
    // runs BEGIN/COMMIT/ROLLBACK around the callback.
    return this.db.transaction(work);
  }

  /**
   * Build a simple WHERE clause for equality comparison.
   *
   * This is a convenience method for the most common WHERE clause pattern.
   * For more complex queries, use `whereAnd()` or build the clause manually.
   *
   * @param column - Column name to filter
   * @param value - Value to match (string, number, boolean, Date, null, or undefined)
   * @returns WHERE clause object
   *
   * @example Basic equality
   * ```typescript
   * const user = await this.adapter.selectOne<User>('users', {
   *   where: this.whereEq('email', 'user@example.com'),
   * });
   * ```
   *
   * @example With null value
   * ```typescript
   * const unverifiedUsers = await this.adapter.select<User>('users', {
   *   where: this.whereEq('emailVerifiedAt', null),
   * });
   * ```
   *
   * @example In update operation
   * ```typescript
   * await this.adapter.update<User>(
   *   'users',
   *   { status: 'active' },
   *   this.whereEq('id', userId),
   *   { returning: '*' }
   * );
   * ```
   *
   * @example In delete operation
   * ```typescript
   * await this.adapter.delete('sessions', this.whereEq('userId', userId));
   * ```
   */
  protected whereEq(column: string, value: unknown): WhereClause {
    return {
      and: [{ column, op: "=", value: value as SqlParam }],
    };
  }

  /**
   * Build a WHERE clause with multiple AND conditions.
   *
   * All conditions must be true for a row to match. This is equivalent to
   * SQL: `WHERE column1 = value1 AND column2 = value2 AND ...`
   *
   * For single equality checks, prefer `whereEq()` for simplicity.
   * For OR conditions, build the clause manually using the WhereClause structure.
   *
   * @param conditions - Object mapping column names to their values
   * @returns WHERE clause object with AND conditions
   *
   * @example Multiple filters
   * ```typescript
   * const activeAdmins = await this.adapter.select<User>('users', {
   *   where: this.whereAnd({
   *     role: 'admin',
   *     status: 'active',
   *     emailVerified: true,
   *   }),
   * });
   * ```
   *
   * @example With null values
   * ```typescript
   * const pendingUsers = await this.adapter.select<User>('users', {
   *   where: this.whereAnd({
   *     status: 'pending',
   *     emailVerifiedAt: null,
   *   }),
   * });
   * ```
   *
   * @example Combined with other options
   * ```typescript
   * const results = await this.adapter.select<Document>('documents', {
   *   where: this.whereAnd({
   *     collectionSlug: 'posts',
   *     status: 'published',
   *   }),
   *   orderBy: [{ column: 'createdAt', direction: 'desc' }],
   *   limit: 10,
   * });
   * ```
   *
   * @example In transaction
   * ```typescript
   * await this.withTransaction(async (tx) => {
   *   const drafts = await tx.select<Document>('documents', {
   *     where: this.whereAnd({
   *       userId: currentUserId,
   *       status: 'draft',
   *     }),
   *   });
   *
   *   // Process drafts...
   * });
   * ```
   *
   * @example For complex OR conditions, build manually
   * ```typescript
   * // For: WHERE (role = 'admin' AND status = 'active') OR (role = 'superadmin')
   * const complexWhere: WhereClause = {
   *   or: [
   *     this.whereAnd({ role: 'admin', status: 'active' }),
   *     this.whereEq('role', 'superadmin'),
   *   ],
   * };
   * const users = await this.adapter.select<User>('users', { where: complexWhere });
   * ```
   */
  protected whereAnd(conditions: Record<string, unknown>): WhereClause {
    return {
      and: Object.entries(conditions).map(([column, value]) => ({
        column,
        op: "=" as const,
        value: value as SqlParam,
      })),
    };
  }

  /**
   * Check if the current database supports a specific feature.
   *
   * Use this method to write database-agnostic code that gracefully handles
   * database-specific features. The adapter will automatically provide fallbacks
   * for unsupported features when possible.
   *
   * ## Database Capabilities
   *
   * | Feature              | PostgreSQL | MySQL | SQLite |
   * |----------------------|------------|-------|--------|
   * | supportsJsonb        | ✅         | ❌    | ❌     |
   * | supportsJson         | ✅         | ✅    | ✅     |
   * | supportsArrays       | ✅         | ❌    | ❌     |
   * | supportsIlike        | ✅         | ❌    | ❌     |
   * | supportsReturning    | ✅         | ❌    | ✅     |
   * | supportsSavepoints   | ✅         | ❌    | ✅     |
   * | supportsOnConflict   | ✅         | ✅    | ✅     |
   * | supportsFts          | ✅         | ⚠️    | ❌     |
   *
   * @param feature - Feature name from DatabaseCapabilities
   * @returns True if the database supports the feature
   *
   * @example Case-insensitive search
   * ```typescript
   * async searchByEmail(email: string): Promise<User[]> {
   *   if (this.supportsFeature('supportsIlike')) {
   *     // PostgreSQL: Use native ILIKE
   *     return this.adapter.select<User>('users', {
   *       where: { and: [{ column: 'email', op: 'ILIKE', value: `%${email}%` }] },
   *     });
   *   } else {
   *     // MySQL/SQLite: Adapter handles LOWER() LIKE fallback
   *     return this.adapter.select<User>('users', {
   *       where: { and: [{ column: 'email', op: 'ILIKE', value: `%${email}%` }] },
   *     });
   *     // Note: Adapter automatically converts ILIKE to LOWER() LIKE for MySQL/SQLite
   *   }
   * }
   * ```
   *
   * @example RETURNING clause support
   * ```typescript
   * async updateAndReturn(id: string, data: Partial<User>): Promise<User> {
   *   if (this.supportsFeature('supportsReturning')) {
   *     // PostgreSQL/SQLite: Use RETURNING
   *     const [updated] = await this.adapter.update<User>(
   *       'users',
   *       data,
   *       this.whereEq('id', id),
   *       { returning: '*' }
   *     );
   *     return updated;
   *   } else {
   *     // MySQL: Adapter automatically does UPDATE + SELECT
   *     const [updated] = await this.adapter.update<User>(
   *       'users',
   *       data,
   *       this.whereEq('id', id),
   *       { returning: '*' }
   *     );
   *     return updated;
   *     // Note: Adapter handles the two-query pattern automatically
   *   }
   * }
   * ```
   *
   * @example Savepoint usage
   * ```typescript
   * async complexUpdate(): Promise<void> {
   *   await this.withTransaction(async (tx) => {
   *     await tx.insert('audit_log', { action: 'started' });
   *
   *     if (this.supportsFeature('supportsSavepoints') && tx.savepoint) {
   *       await tx.savepoint('before_update');
   *
   *       try {
   *         await tx.update('sensitive_data', { value: 'new' }, this.whereEq('id', '1'));
   *       } catch (error) {
   *         await tx.rollbackToSavepoint!('before_update');
   *         this.logger.warn('Update failed, rolled back to savepoint');
   *       }
   *     } else {
   *       // MySQL: No savepoints, handle differently
   *       await tx.update('sensitive_data', { value: 'new' }, this.whereEq('id', '1'));
   *     }
   *   });
   * }
   * ```
   *
   * @example JSON/JSONB storage
   * ```typescript
   * async storeMetadata(id: string, metadata: object): Promise<void> {
   *   if (this.supportsFeature('supportsJsonb')) {
   *     // PostgreSQL: Use JSONB for better performance
   *     this.logger.info('Using JSONB column for metadata');
   *   } else if (this.supportsFeature('supportsJson')) {
   *     // MySQL/SQLite: Use JSON column
   *     this.logger.info('Using JSON column for metadata');
   *   }
   *
   *   await this.adapter.update(
   *     'documents',
   *     { metadata: JSON.stringify(metadata) },
   *     this.whereEq('id', id)
   *   );
   * }
   * ```
   *
   * @example All capabilities
   * ```typescript
   * logDatabaseCapabilities(): void {
   *   const caps = this.adapter.getCapabilities();
   *   this.logger.info('Database capabilities', {
   *     dialect: caps.dialect,
   *     jsonb: caps.supportsJsonb,
   *     arrays: caps.supportsArrays,
   *     ilike: caps.supportsIlike,
   *     returning: caps.supportsReturning,
   *     savepoints: caps.supportsSavepoints,
   *     fts: caps.supportsFts,
   *   });
   * }
   * ```
   */
  protected supportsFeature(feature: keyof DatabaseCapabilities): boolean {
    const capabilities = this.adapter.getCapabilities();
    return !!capabilities[feature];
  }

  /**
   * Format a Date for database insertion.
   *
   * MySQL requires datetime in 'YYYY-MM-DD HH:MM:SS' format, while PostgreSQL
   * and SQLite accept ISO 8601 format ('YYYY-MM-DDTHH:MM:SS.sssZ').
   *
   * @param date - Date to format (defaults to current date/time)
   * @returns Formatted date string appropriate for the current database dialect
   *
   * @example
   * ```typescript
   * const now = this.formatDateForDb();
   * await this.adapter.insert('records', { created_at: now });
   * ```
   */
  protected formatDateForDb(date: Date = new Date()): Date {
    return date;
  }

  /**
   * Normalize a value from the database into a standard ISO 8601 UTC string.
   *
   * Crucial for dynamic tables (Singles) where the DB driver might parse
   * naive datetime strings using the server's local timezone.
   *
   * @param value - The value from the database (Date, string, or unknown)
   * @returns Optimized ISO string with explicit UTC 'Z' offset
   */
  protected normalizeDbTimestamp(value: unknown): string | null {
    return normalizeDbTimestamp(value);
  }
}
