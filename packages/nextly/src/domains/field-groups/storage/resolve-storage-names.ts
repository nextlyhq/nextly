/**
 * Which spelling the field-group storage in this database actually uses.
 *
 * The storage migration renames the registry table and every data table's type
 * discriminator. Both spellings therefore exist in the world at once — one per
 * database, depending on whether that database has run the migration — and the
 * read path has to address whichever is really there.
 *
 * 🔴 Resolved from the **catalog**, never from the migration marker. The marker
 * is a recorded claim; the catalog is an observable fact. A database restored
 * from a backup or repaired by hand can carry a marker that disagrees with its
 * own storage, which is precisely the case a reader must survive, so a
 * resolution that depends on the marker is wrong exactly when it matters.
 *
 * The one rule, applied to both names:
 *
 * > **Read the migrated spelling only when the legacy one is absent.**
 *
 * That is the preference order the migration itself uses. It is the only order
 * correct in both directions: `up` renames the registry last and `down` renames
 * it first, so "legacy if present" always names the live object and never
 * adopts one this migration did not move.
 *
 * Every value returned here is one of the two constants, never the catalog's
 * own spelling of it. The registry name is used as a `SchemaRegistry` key and
 * the column name becomes a Drizzle column's emitted identifier, so both have
 * to be the name the rest of the code knows. The catalog decides *which* of the
 * two; it does not supply the string.
 *
 * The decisions are pure functions over a catalog listing, and the exported
 * `resolve*` wrappers are the I/O that feeds them. That split is what lets the
 * folding and mixed-generation cases be tested without a database, while the
 * three-dialect matrix covers the reading itself.
 *
 * @module domains/field-groups/storage/resolve-storage-names
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";
import { readIdentifierCaseRules } from "../../schema/utils/read-identifier-case";
import {
  indexCatalog,
  resolveCatalogName,
} from "../../schema/utils/resolve-catalog-name";
import type { IdentifierCaseRules } from "../../schema/utils/resolve-catalog-name";
import { MIGRATION_TARGET } from "../migration/manifest";
import type { TableColumns } from "../migration/reconcile";

/**
 * The adapter surface this module needs.
 *
 * Declared structurally rather than importing `DrizzleAdapter` so a caller
 * holding a narrower adapter can still resolve, and so the wrappers can be
 * exercised without constructing one.
 */
export interface StorageNameAdapter {
  dialect: SupportedDialect;
  listTables(): Promise<string[]>;
  getDrizzle<T = unknown>(): T;
}

/** The registry table a database holds, and whether it has been migrated. */
export interface FieldGroupRegistryTable {
  /** The name to address, always one of the two constants. */
  name: string;
  /** `true` when the migrated registry is the one present. */
  migrated: boolean;
}

/**
 * Cached per adapter: see {@link forgetFieldGroupStorageNames}.
 *
 * Reassignable because a `WeakMap` cannot be enumerated, so "forget everything"
 * can only be expressed by replacing it. Nothing outside this module holds a
 * reference to the map, so replacing it is invisible to callers.
 */
let registryTableCache = new WeakMap<
  StorageNameAdapter,
  Promise<FieldGroupRegistryTable>
>();

/**
 * Choose the registry table from a catalog listing.
 *
 * Neither present is not an error: a database that has not created one yet
 * resolves to the legacy name, because that is what this release's system-table
 * DDL is about to create.
 */
export function chooseRegistryTable(
  tables: readonly string[],
  rules: IdentifierCaseRules
): FieldGroupRegistryTable {
  const catalog = indexCatalog(tables, rules.tables);
  if (resolveCatalogName(catalog, STORAGE_FORMAT.registryTable) !== undefined) {
    return { name: STORAGE_FORMAT.registryTable, migrated: false };
  }
  if (
    resolveCatalogName(catalog, MIGRATION_TARGET.registryTable) !== undefined
  ) {
    return { name: MIGRATION_TARGET.registryTable, migrated: true };
  }
  return { name: STORAGE_FORMAT.registryTable, migrated: false };
}

/**
 * Choose the discriminator column for each requested table.
 *
 * 🔴 Per table, not once per database, and none of the three reasons is
 * hypothetical:
 *
 * 1. The migration renames the registry **last**, so between the first table's
 *    rename and the registry's there is a window — and after a crash, a lasting
 *    state — where data columns have moved and the registry has not. A single
 *    generation read off the registry name is wrong for every table in it.
 * 2. A table whose stored name this migration did not generate (an author's
 *    `dbName`) is never renamed, while its column always is. Table generation
 *    and column generation are independent by construction.
 * 3. The DDL that creates a field-group table writes the current release's
 *    spelling, so a group created after a migration carries the legacy column
 *    while its siblings carry the migrated one until the creator flips too.
 *
 * A table the catalog does not describe, including one that does not exist yet,
 * resolves to the legacy spelling: that is what the DDL writes, so a table
 * about to be created is addressed correctly rather than refused.
 */
export function chooseTypeColumns(
  catalog: readonly TableColumns[],
  tables: readonly string[],
  rules: IdentifierCaseRules
): Map<string, string> {
  // Indexed under the server's own table rules, because MySQL with
  // `lower_case_table_names=1` reports a lowercased name for a table asked for
  // under another case, and an exact comparison would discard the entry
  // describing the very table requested.
  const byTable = indexCatalog(
    catalog.map(entry => entry.table),
    rules.tables
  );

  const resolved = new Map<string, string>();
  for (const table of tables) {
    const catalogName = resolveCatalogName(byTable, table);
    const entry = catalog.find(candidate => candidate.table === catalogName);
    resolved.set(
      table,
      entry === undefined
        ? STORAGE_FORMAT.columns.type
        : chooseTypeColumn(entry.columns, rules)
    );
  }
  return resolved;
}

/** The discriminator on one table's column list. */
function chooseTypeColumn(
  columns: readonly string[],
  rules: IdentifierCaseRules
): string {
  const catalog = indexCatalog(columns, rules.columns);
  if (resolveCatalogName(catalog, STORAGE_FORMAT.columns.type) !== undefined) {
    return STORAGE_FORMAT.columns.type;
  }
  if (resolveCatalogName(catalog, MIGRATION_TARGET.columnType) !== undefined) {
    return MIGRATION_TARGET.columnType;
  }
  return STORAGE_FORMAT.columns.type;
}

/**
 * The registry table this database actually holds.
 *
 * Memoized per adapter. `FieldGroupRegistryService` is a DI singleton, so an
 * unmemoized resolution would add a catalog round trip to every registry query
 * — an entry read populating several field groups issues one per group. Caching
 * a schema fact for the life of a process is what every mature ORM does (Rails
 * caches the schema and expects a restart after a migration; Django caches
 * introspection) and it is what Nextly already does with the runtime Drizzle
 * tables, which are registered once at boot and are equally stale if a table is
 * renamed under a live process.
 *
 * A memo that outlives a migration performed by a *different* process fails
 * loudly — the table it names is gone — rather than silently reading the wrong
 * one. {@link forgetFieldGroupStorageNames} is how the process that performs a
 * migration drops its own.
 */
export async function resolveFieldGroupRegistryTable(
  adapter: StorageNameAdapter
): Promise<FieldGroupRegistryTable> {
  const cached = registryTableCache.get(adapter);
  if (cached !== undefined) return cached;

  // The promise is cached, not the value, so concurrent callers during boot
  // share one catalog read instead of racing to issue several.
  const pending = readRegistryTable(adapter);
  registryTableCache.set(adapter, pending);
  try {
    return await pending;
  } catch (error) {
    // A failed probe must not be remembered as the answer, or one transient
    // catalog error would pin the process to a wrong name for its whole life.
    registryTableCache.delete(adapter);
    throw error;
  }
}

/** Convenience for the many callers that only need the name. */
export async function resolveRegistryTableName(
  adapter: StorageNameAdapter
): Promise<string> {
  return (await resolveFieldGroupRegistryTable(adapter)).name;
}

/**
 * Drop the memoized resolution.
 *
 * Called by the process that runs the migration, immediately after storage
 * moves. Omitting the adapter clears every entry, which is what a test sharing
 * one module instance across fixtures needs.
 */
export function forgetFieldGroupStorageNames(
  adapter?: StorageNameAdapter
): void {
  if (adapter === undefined) {
    registryTableCache = new WeakMap();
    return;
  }
  registryTableCache.delete(adapter);
}

/**
 * The discriminator column each named data table actually carries.
 *
 * One `introspectLiveSnapshot` covers every table, so the cost is a single
 * catalog read at the point runtime schemas are registered — boot, or a schema
 * mutation — and nothing on a read path. Not memoized for the same reason:
 * every caller already holds the full list it cares about.
 */
export async function resolveTypeColumns(
  adapter: StorageNameAdapter,
  tables: readonly string[]
): Promise<Map<string, string>> {
  if (tables.length === 0) return new Map();

  const rules = await readIdentifierCaseRules(adapter);
  const snapshot = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    adapter.dialect,
    [...tables]
  );
  return chooseTypeColumns(
    snapshot.tables.map(entry => ({
      table: entry.name,
      columns: entry.columns.map(column => column.name),
    })),
    tables,
    rules
  );
}

async function readRegistryTable(
  adapter: StorageNameAdapter
): Promise<FieldGroupRegistryTable> {
  const rules = await readIdentifierCaseRules(adapter);
  return chooseRegistryTable(await adapter.listTables(), rules);
}
