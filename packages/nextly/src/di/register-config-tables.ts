/**
 * The start's registration of the configuration's own collections and Singles
 * as runtime tables in the schema registry, beside the registry rows'.
 *
 * A module of its own, apart from `register.ts`, because a reload of the
 * dynamic tables runs the same step: importing it from here loads what the
 * step needs (its generators, loaded when it runs) rather than the whole
 * service registry.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Table } from "drizzle-orm";

import type { SchemaRegistry } from "../database/schema-registry";
import type { FieldDefinition } from "../schemas/dynamic-collections";
import type { Logger } from "../services/shared";

import type { NextlyServiceConfig } from "./register";
import type { RuntimeTableEntity } from "./register-runtime-tables";

/**
 * Belt-and-suspenders: also register every code-first collection and
 * single from the supplied config directly into the resolver. The
 * `loadDynamicTables` pass inside initializeSchemaRegistry reads from
 * the `dynamic_collections` / `dynamic_singles` DB tables and swallows
 * errors on failure, which means a silent read hiccup (SQLite driver
 * quirk, partially-written row, wrong JSON shape on the `fields`
 * column) leaves code-first tables invisible at runtime. Registering
 * straight from the loaded `NextlyConfig` sidesteps that failure mode
 * entirely for code-first tables - the DB is still the source of
 * truth for UI-created tables via `loadDynamicTables`.
 */
export async function registerConfigTablesQuietly(
  schemaRegistry: SchemaRegistry | undefined,
  transformedConfig: NextlyServiceConfig,
  adapter: DrizzleAdapter,
  logger: Logger,
  overrides?: { differed: boolean }
): Promise<void> {
  if (!schemaRegistry) return;
  try {
    await registerConfigTablesInResolver(
      schemaRegistry,
      transformedConfig,
      adapter,
      logger,
      overrides
    );
  } catch (err) {
    // Non-fatal: the DB-backed pass may still have registered these
    // tables. Log at debug so real issues surface during dev.
    logger.debug?.(
      `[registerServices] Could not register config tables into resolver: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Register every code-first collection and single from the config as a
 * runtime Drizzle schema in the resolver. Complements `loadDynamicTables`
 * which reads the same data from the `dynamic_*` DB registry; having both
 * paths makes the resolver correct even when the DB read silently fails
 * or when a just-synced row hasn't been flushed yet.
 *
 * No-op for tables that are already registered (e.g. from the DB pass).
 *
 * Exported for its test.
 */
export async function registerConfigTablesInResolver(
  registry: SchemaRegistry,
  config: NextlyServiceConfig,
  adapter: DrizzleAdapter,
  logger: Partial<Logger>,
  /**
   * Told, where given, whether a table this registers replaced one the
   * registry pass had registered with different columns: the definitions
   * the start serves then differ from the stored registry, and the start's
   * load may not be recorded as following it (`definitionsLoaded`).
   */
  overrides?: { differed: boolean }
): Promise<void> {
  const dialect = adapter.getCapabilities().dialect;
  const observed = await observedRegistry(registry, overrides);
  // Loaded here, as the generators it calls were, so they stay out of this
  // module's own load.
  const { registerEntityRuntimeTables } = await import(
    "./register-runtime-tables"
  );
  const register = (entity: RuntimeTableEntity) =>
    registerEntityRuntimeTables(observed, entity, dialect);

  // Collections: table name convention is `dc_<slug-with-underscores>`.
  for (const collection of config.collections ?? []) {
    registerConfigEntity(
      collection,
      "collection",
      (slug, dbName) => {
        const baseTableName = dbName ?? slug.replace(/-/g, "_");
        return baseTableName.startsWith("dc_")
          ? baseTableName
          : `dc_${baseTableName}`;
      },
      register,
      logger
    );
  }

  // Singles: table name convention is `single_<slug-with-underscores>`.
  // so every code path agrees on the physical table name.
  const { resolveSingleTableName } = await import(
    "../domains/singles/services/resolve-single-table-name"
  );
  for (const single of config.singles ?? []) {
    // The same registration as a collection's, so a localized single's
    // main table leaves out the columns its migrations put on the companion.
    registerConfigEntity(
      single,
      "single",
      (slug, dbName) => resolveSingleTableName({ slug, dbName }),
      register,
      logger
    );
  }
}

/**
 * `registry`, with every registration through it compared, where `overrides`
 * is given, against the table it replaces: a replacement of a registry-backed
 * table with columns that differ sets `overrides.differed`.
 */
async function observedRegistry(
  registry: SchemaRegistry,
  overrides: { differed: boolean } | undefined
): Promise<Pick<SchemaRegistry, "registerDynamicSchema">> {
  const { entityKind, getColumns } = await import("drizzle-orm");
  /**
   * A table's columns as it reads and writes them, sorted: each column's
   * Drizzle class, which holds its decoder and encoder (`SQLiteBoolean` and
   * `SQLiteInteger` are both `integer`), its SQL type, and every setting it
   * was built with, the name, nullability and mode among them. A function
   * setting (a mapper, a default) is rebuilt with each column, so it is
   * described by its source. Read through `getColumns`, Drizzle v1's column
   * accessor, typed as a `Table` so it returns the column map rather than a
   * view's selected fields.
   */
  const columnsOf = (table: unknown): string =>
    Object.values(getColumns(table as Table))
      .map(column =>
        JSON.stringify([
          Reflect.get(column.constructor, entityKind) as unknown,
          column.getSQLType(),
          describeSetting(column, entityKind),
        ])
      )
      .sort()
      .join("\n");
  return {
    registerDynamicSchema: (tableName, table) => {
      if (overrides !== undefined && registry.hasTable(tableName)) {
        const existing = registry.getTable(tableName);
        if (
          typeof existing === "object" &&
          existing !== null &&
          columnsOf(existing) !== columnsOf(table)
        ) {
          overrides.differed = true;
        }
      }
      registry.registerDynamicSchema(tableName, table);
    },
  };
}

/**
 * One config collection or Single registered as a runtime table named by
 * `tableNameOf`, or, where it cannot be, the reason logged at debug, so one
 * entity that fails costs no other its registration. An entity with no slug
 * or no fields registers nothing. The status flag gives the runtime table its
 * system status column, which Draft/Published CRUD reads and writes; the
 * localized one leaves the translatable columns to the companion.
 */
function registerConfigEntity(
  entity: unknown,
  kind: "collection" | "single",
  tableNameOf: (slug: string, dbName: string | undefined) => string,
  register: (entity: RuntimeTableEntity) => void,
  logger: Partial<Logger>
): void {
  try {
    const slug = (entity as { slug: string }).slug;
    const dbName = (entity as { dbName?: string }).dbName;
    const fields = (entity as { fields?: unknown[] }).fields ?? [];
    if (!slug || !Array.isArray(fields) || fields.length === 0) return;
    register({
      slug,
      tableName: tableNameOf(slug, dbName),
      fields: fields as FieldDefinition[],
      status: (entity as { status?: boolean }).status === true,
      localized: (entity as { localized?: boolean }).localized === true,
    });
  } catch (err) {
    logger.debug?.(
      `[registerServices] Failed to register ${kind} "${(entity as { slug?: string }).slug ?? "?"}" in resolver: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * A column setting as comparable data: functions by their source, objects by
 * their Drizzle kind and their own settings in key order. The column's table,
 * and its `config` (the settings it was built from, which it holds again on
 * itself), are left out, and a value met again on the way is not followed.
 */
function describeSetting(
  value: unknown,
  kind: symbol,
  seen: Set<object> = new Set()
): unknown {
  if (typeof value === "function") return `fn:${String(value)}`;
  if (typeof value === "bigint") return `bigint:${value}`;
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[seen]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map(item => describeSetting(item, kind, seen));
  }
  if (value instanceof Date) return `date:${value.toISOString()}`;
  const ownKind: unknown =
    typeof value.constructor === "function"
      ? Reflect.get(value.constructor, kind)
      : undefined;
  return [
    typeof ownKind === "string" ? ownKind : null,
    Object.keys(value)
      .filter(key => key !== "table" && key !== "config")
      .sort()
      .map(key => [
        key,
        describeSetting((value as Record<string, unknown>)[key], kind, seen),
      ]),
  ];
}
