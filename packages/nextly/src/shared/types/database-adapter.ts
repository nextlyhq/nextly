/**
 * Database Adapter Type
 *
 * Provides a type-level description of the database and table shapes
 * used by BaseService. This enables generic typing of the lazy-cached
 * `db` and `tables` getters without coupling BaseService to a concrete
 * dialect (PostgreSQL, MySQL, SQLite).
 *
 * The default types use `any` because:
 * 1. The Drizzle instance type varies by dialect (NodePgDatabase,
 *    MySql2Database, BetterSQLite3Database)
 * 2. The table schema type varies by dialect
 * 3. Importing all three would break tree-shaking
 * 4. 43+ existing child services rely on these being permissive
 *
 * Dialect-specific adapters can narrow these types via the generic
 * parameter: `class MyService extends BaseService<{ db: NodePgDatabase; tables: typeof pgTables }>`
 *
 * @module shared/types/database-adapter
 * @since 1.0.0
 */

/**
 * Shape descriptor for the database layer.
 *
 * `db` is the Drizzle instance returned by `adapter.getDrizzle()`.
 * `tables` is the dialect-specific table schema from `getDialectTables()`.
 */
export interface DatabaseAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tables: any;
}
