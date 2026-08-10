import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { buildFieldGroupRegistryTable } from "../domains/field-groups/storage/registry-schemas";
import { env } from "../lib/env";
import type { CoreSchemaOptions } from "../schemas";
import * as schemasMy from "../schemas/_dialect-bundles/mysql";
import * as schemasPg from "../schemas/_dialect-bundles/postgres";
import * as schemasSl from "../schemas/_dialect-bundles/sqlite";
import { STORAGE_FORMAT } from "../schemas/storage-format";

/**
 * Which registry the push bundle declares.
 *
 * Widens {@link CoreSchemaOptions} with `null`, which the desired-shape snapshot
 * has no use for but the push does: the push CREATES from its bundle, so a
 * caller that cannot establish which registry exists must be able to say
 * "declare neither" rather than being forced to name one.
 */
interface PushBundleOptions {
  fieldGroupRegistryTable?: CoreSchemaOptions["fieldGroupRegistryTable"] | null;
}

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
// Use CLI commands (nextly db:sync, nextly migrate) or import directly from
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

/**
 * The same bundle, with the field-group registry named as this database has it.
 *
 * Separate from {@link getDialectTables} on purpose. That one is read by a
 * dozen callers for their precise table types (`tables.users.id`), and widening
 * its return so one key can vary would cost every one of them their typing for
 * a concern none of them have. This is for the push path alone, which hands the
 * bundle to drizzle-kit as an untyped record.
 *
 * 🔴 SWAPPED, never added. This bundle is what `freshPushSchema` CREATES, so
 * declaring both spellings would create an empty second registry on every
 * database that has not migrated. Exactly one of the two exists in any
 * database, and this names that one.
 */
export function getDialectTablesForPush(
  dialect: SupportedDialect,
  options?: PushBundleOptions
): Record<string, unknown> {
  const bundle: Record<string, unknown> = getDialectTables(dialect);
  const name = options?.fieldGroupRegistryTable;
  if (name === undefined || name === STORAGE_FORMAT.registryTable) {
    return bundle;
  }
  if (name === null) {
    // 🔴 Declared as NEITHER, because the caller could not establish which of
    // the two this database holds. Naming the wrong one creates it, and a
    // CREATE is additive so no safety net stops it; omitting it lets
    // drizzle-kit propose a DROP instead, which `filterUnsafeStatements` blocks
    // and reports. Between a silent wrong create and a blocked loud drop, only
    // one loses data's reachability.
    const { dynamicFieldGroups: _omitted, ...rest } = bundle;
    return rest;
  }
  return {
    ...bundle,
    dynamicFieldGroups: buildFieldGroupRegistryTable(dialect, name),
  };
}
