import type { AnyRelations } from "drizzle-orm";

import { env } from "../lib/env";
import * as schemasMy from "../schemas/_dialect-bundles/mysql";
import { relations as relationsMy } from "../schemas/_dialect-bundles/mysql.relations";
import * as schemasPg from "../schemas/_dialect-bundles/postgres";
import { relations as relationsPg } from "../schemas/_dialect-bundles/postgres.relations";
import * as schemasSl from "../schemas/_dialect-bundles/sqlite";
import { relations as relationsSl } from "../schemas/_dialect-bundles/sqlite.relations";

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
/**
 * The prebuilt static drizzle v2 relations for a dialect (no dynamic
 * edges). Runtime code should prefer SchemaRegistry.getRelations(),
 * which layers dynamic-entity edges on top; this helper serves early
 * boot paths that run before the registry singleton exists.
 */
export function getStaticRelations(dialect?: string): AnyRelations {
  const d = dialect ?? env.DB_DIALECT ?? "sqlite";
  if (d === "postgresql" || d === "postgres") {
    return relationsPg;
  }
  if (d === "mysql") return relationsMy;
  return relationsSl;
}

export function getDialectTables(dialect?: string) {
  const dbDialect = dialect || env.DB_DIALECT;
  if (dbDialect === "postgresql") return schema.postgres;
  if (dbDialect === "mysql") return schema.mysql;
  if (dbDialect === "sqlite") return schema.sqlite;
  throw new Error(`Unsupported dialect: ${dbDialect}`);
}
