/**
 * The names a field group's storage takes on this site: the registry table, the prefix a derived
 * table name carries, and the discriminator column a data table is created with.
 *
 * A site is on one of two namings. `legacy` is what every site created before the current names
 * holds (`dynamic_components`, `comp_<slug>`, `_component_type`); `current` is what the storage
 * migration moves a site to, and what a new site starts on (`dynamic_field_groups`, `fg_<slug>`,
 * `_field_group_type`). Which one a site is on is read from its catalog: the registry table it
 * holds (`resolveFieldGroupRegistryTable`). Nothing here reads the migration's marker.
 *
 * 🔴 Only a group with no registry row takes a name from here. A group the registry holds is
 * addressed by its stored `table_name`, whatever naming it was created under: storage is never
 * repointed by deriving a name again. And `resolveComponentTableName` stays the legacy derivation,
 * because the storage migration decides which tables it owns by comparing against it.
 *
 * @module domains/field-groups/services/field-group-storage-names
 */

import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { resolveComponentTableName } from "../../schema/utils/resolve-table-name";
import { MIGRATION_TARGET } from "../migration/target";
import {
  resolveFieldGroupRegistryTable,
  type FieldGroupRegistryName,
  type StorageNameAdapter,
} from "../storage/resolve-storage-names";

/** Which naming a site's field-group storage is on. */
export type FieldGroupNaming = "legacy" | "current";

/** The names one naming gives. */
export interface FieldGroupStorageNames {
  naming: FieldGroupNaming;
  /** The registry table. */
  registryTable: FieldGroupRegistryName;
  /** The prefix a table name derived from a slug carries. */
  tablePrefix:
    | typeof STORAGE_FORMAT.tablePrefix
    | typeof MIGRATION_TARGET.tablePrefix;
  /** The discriminator column a new data table is created with. */
  typeColumn:
    | typeof STORAGE_FORMAT.columns.type
    | typeof MIGRATION_TARGET.columnType;
}

const LEGACY: FieldGroupStorageNames = {
  naming: "legacy",
  registryTable: STORAGE_FORMAT.registryTable,
  tablePrefix: STORAGE_FORMAT.tablePrefix,
  typeColumn: STORAGE_FORMAT.columns.type,
};

const CURRENT: FieldGroupStorageNames = {
  naming: "current",
  registryTable: MIGRATION_TARGET.registryTable,
  tablePrefix: MIGRATION_TARGET.tablePrefix,
  typeColumn: MIGRATION_TARGET.columnType,
};

/** The names `naming` gives. */
export function storageNamesFor(
  naming: FieldGroupNaming
): FieldGroupStorageNames {
  return naming === "current" ? CURRENT : LEGACY;
}

/** The naming a registry table name belongs to. */
export function namingOfRegistry(registryTable: string): FieldGroupNaming {
  return registryTable === MIGRATION_TARGET.registryTable
    ? "current"
    : "legacy";
}

/**
 * The table a new field group with `slug` is created under, in `naming`.
 *
 * The current name is the one the storage migration would move the legacy name to, so a group
 * created after a migration is indistinguishable from one the migration moved.
 */
export function fieldGroupTableNameFor(
  naming: FieldGroupNaming,
  slug: string
): string {
  return underNaming(naming, resolveComponentTableName(slug));
}

/**
 * A table name derived under the legacy prefix, moved to `naming`'s prefix.
 *
 * For a caller whose derivation is the legacy prefix and the slug's table form (the migration
 * generator's merge of code-first and Builder groups): the form is kept and only the prefix moves,
 * as the storage migration moves a derived name. A name without the legacy prefix is returned as
 * it is.
 */
export function underNaming(
  naming: FieldGroupNaming,
  tableName: string
): string {
  if (
    naming === "legacy" ||
    !tableName.startsWith(STORAGE_FORMAT.tablePrefix)
  ) {
    return tableName;
  }
  return `${MIGRATION_TARGET.tablePrefix}${tableName.slice(STORAGE_FORMAT.tablePrefix.length)}`;
}

/**
 * Whether `tableName` is the name `slug` derives under either naming.
 *
 * A stored name that is one of these is the group's own storage, created by a release or a
 * migration under the naming that stood then, and is used as stored. Any other stored name is not
 * one a slug derives, and the callers report or repair it as before.
 */
export function isDerivedTableName(slug: string, tableName: string): boolean {
  return (
    tableName === fieldGroupTableNameFor("legacy", slug) ||
    tableName === fieldGroupTableNameFor("current", slug)
  );
}

/** The names this site's field-group storage is on, read from its catalog. */
export async function resolveFieldGroupStorageNames(
  adapter: StorageNameAdapter
): Promise<FieldGroupStorageNames> {
  const registry = await resolveFieldGroupRegistryTable(adapter);
  return storageNamesFor(registry.migrated ? "current" : "legacy");
}
