import { env } from "../lib/env";
import * as schemasMy from "../schemas/_dialect-bundles/mysql";
import * as schemasPg from "../schemas/_dialect-bundles/postgres";
import * as schemasSl from "../schemas/_dialect-bundles/sqlite";

/**
 * Backwards-compatible `schema.postgres` / `schema.mysql` / `schema.sqlite`
 * namespaces. Replaces the old `database/schema/<dialect>.ts` stubs deleted
 * in Plan A Task 17. Each namespace is a flat re-export of every Drizzle
 * table + relations the framework manages for the given dialect, drawn
 * from the canonical `@nextly/schemas/<feature>/<dialect>` modules.
 */
const schema = {
  postgres: schemasPg,
  mysql: schemasMy,
  sqlite: schemasSl,
};

export { schema };
export * from "./errors";
export { env } from "../lib/env";

// Re-export from factory (new adapter system only)
export {
  createAdapter,
  createAdapterFromEnv,
  validateDatabaseEnv,
  checkAdapterHealth,
  type AdapterConfig,
  type AdapterType,
} from "./factory";

export { healthCheck, type HealthCheckResult } from "./health";

// Pattern A wrapper from the unified error system (spec §8.3): auto-convert
// DbError thrown inside a DB-touching block to a NextlyError with a generic
// public message and rich logContext.
export { withDbErrors } from "./with-db-errors";

// Note: initDatabase, quickInitDatabase, seedAll, seedPermissions are NOT exported here
// as they contain Node.js-only code (fileURLToPath, fs, path).
// Use CLI commands (nextly dev --seed, nextly migrate) or import directly from
// 'nextly/database/init' or 'nextly/database/seeders' for server-side use.

/**
 * Get the appropriate dialect-specific table schemas based on the configured database dialect.
 * Centralizes dialect selection logic that was previously duplicated across services.
 *
 * @param dialect - Optional dialect override. If not provided, uses env.DB_DIALECT
 * @returns Schema object for the configured dialect (postgres, mysql, or sqlite)
 */
export { getStaticRelations } from "./static-relations";

export function getDialectTables(dialect?: string) {
  const dbDialect = dialect || env.DB_DIALECT;
  if (dbDialect === "postgresql") return schema.postgres;
  if (dbDialect === "mysql") return schema.mysql;
  if (dbDialect === "sqlite") return schema.sqlite;
  throw new Error(`Unsupported dialect: ${dbDialect}`);
}
