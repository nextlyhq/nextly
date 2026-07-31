/**
 * The field-group registry, declared under both of its names.
 *
 * `SchemaRegistry.registerStaticSchemas` keys a table by the physical SQL name
 * the Drizzle object carries, and `adapter.select`/`insert`/`update`/`delete`
 * look a table up by that same key. So a database whose registry has been
 * renamed cannot be addressed at all unless an object built under the renamed
 * name is registered: there is no handle to redirect, because the handle *is*
 * the name.
 *
 * Registering both is what makes the two spellings addressable from one build.
 * It is not an alias — each object names exactly the table it is built for, and
 * nothing decides which to address here. {@link resolveFieldGroupRegistryTable}
 * makes that choice from the catalog, and only one of the two tables exists in
 * any database.
 *
 * 🔴 This bundle is for the schema **registry** only, never for a schema
 * **push**. `getDialectTables` feeds `freshPushSchema`, and adding the migrated
 * spelling there would create an empty second registry on every database that
 * has never migrated.
 *
 * @module domains/field-groups/storage/registry-schemas
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import {
  buildDynamicFieldGroupsMysql,
  buildDynamicFieldGroupsPg,
  buildDynamicFieldGroupsSqlite,
} from "../../../schemas/dynamic-field-groups";
import { MIGRATION_TARGET } from "../migration/manifest";

/** Build the registry table for a dialect under an explicit name. */
export function buildFieldGroupRegistryTable(
  dialect: SupportedDialect,
  tableName: string
): unknown {
  switch (dialect) {
    case "postgresql":
      return buildDynamicFieldGroupsPg(tableName);
    case "mysql":
      return buildDynamicFieldGroupsMysql(tableName);
    case "sqlite":
      return buildDynamicFieldGroupsSqlite(tableName);
    default: {
      const exhaustive: never = dialect;
      throw NextlyError.internal({
        logContext: {
          reason: "cannot build the field-group registry for this dialect",
          dialect: String(exhaustive),
        },
      });
    }
  }
}

/**
 * The migrated-name registry object, keyed for `registerStaticSchemas`.
 *
 * Spread alongside `getDialectTables(dialect)` at every site that builds a
 * schema registry. The legacy-name object already arrives from that bundle, so
 * only the migrated one is added here.
 *
 * The key is the export name rather than the table name because
 * `registerStaticSchemas` re-keys every Drizzle table by its physical name; the
 * key below is only what the object is called in the map it travels in.
 */
export function getFieldGroupRegistryAliases(
  dialect: SupportedDialect
): Record<string, unknown> {
  return {
    dynamicFieldGroupsMigrated: buildFieldGroupRegistryTable(
      dialect,
      MIGRATION_TARGET.registryTable
    ),
  };
}
