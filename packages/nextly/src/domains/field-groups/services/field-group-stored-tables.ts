/**
 * The table each field group is stored under, read from the registry.
 *
 * A derived name is a guess about physical storage, and guessing is what creates an empty table
 * beside the populated one a caller meant to edit. Every path that addresses an existing group's
 * table reads it here, and derives a name only for a group the registry does not hold yet, under
 * the naming the site's storage is on (`field-group-storage-names`).
 *
 * Moved here from the reload's plan module so a domain path (the Schema Builder save) and a start
 * check can read it without importing from `init/`; that module re-exports it.
 *
 * @module domains/field-groups/services/field-group-stored-tables
 */

import { sql, type SQL } from "drizzle-orm";

import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { readIdentifierCaseRules } from "../../schema/utils/read-identifier-case";
import {
  indexCatalog,
  resolveCatalogName,
} from "../../schema/utils/resolve-catalog-name";
import { MIGRATION_TARGET } from "../migration/target";
import { resolveFieldGroupRegistryName } from "../storage/resolve-storage-names";

import {
  fieldGroupTableNameFor,
  namingOfRegistry,
  type FieldGroupNaming,
} from "./field-group-storage-names";

/**
 * What reading the registry needs.
 *
 * Declared structurally rather than importing the reload's own adapter type,
 * so this module depends on the two calls it makes and not on the shape of a
 * caller that also does DDL and writes.
 */
export interface RegistryReadAdapter {
  readonly dialect: "postgresql" | "mysql" | "sqlite";
  getDrizzle<T = unknown>(): T;
  /** The storage migration renames the registry, so its name is read, not spelled. */
  listTables(): Promise<string[]>;
  /** Normalises the three driver envelopes in one place. */
  queryStatement<T = Record<string, unknown>>(statement: SQL): Promise<T[]>;
}

/** What a reload knows about where its field groups are physically stored. */
export interface StoredFieldGroupTables {
  /** `slug` → the physical table name the registry records. */
  tables: Map<string, string>;
  /**
   * Whether those names can be relied on.
   *
   * 🔴 The distinction this type exists for: a registry that is ABSENT means a
   * fresh database, where deriving `comp_*` names is correct. A registry that
   * is PRESENT but unreadable means the names are UNKNOWN, and deriving them
   * addresses storage that is not there — which is how a reload creates an
   * empty table beside the populated one it meant to edit. Only the first case
   * may guess.
   */
  usable: boolean;
  /**
   * The naming the registry read is on (`field-group-storage-names`): the name a
   * group the registry does not hold yet is created under. Legacy where no
   * registry could be read.
   */
  naming: FieldGroupNaming;
  /**
   * Why the read failed, when it did.
   *
   * Present only on the failure path, and carried so the caller's log can name
   * the cause rather than only the symptom.
   */
  reason?: string;
}

/**
 * The table a field group is stored under: the one the registry records, or,
 * for a group it does not hold yet, the one it is created under on this site.
 */
export function storedOrNewTableName(
  stored: Pick<StoredFieldGroupTables, "tables" | "naming">,
  slug: string
): string {
  return stored.tables.get(slug) ?? fieldGroupTableNameFor(stored.naming, slug);
}

/**
 * The physical table name each field group is stored under.
 *
 * Read rather than derived: `resolveComponentTableName` answers what this
 * release's creator WOULD name a table, while the registry records what it is
 * actually called. They differ for an author-chosen `dbName`, and after the
 * storage migration for every field group.
 *
 * Issued through the adapter's statement path so the three driver envelopes are
 * normalised in one place, and so an unrecognised shape is refused rather than
 * reported as no rows.
 */
export async function readStoredFieldGroupTables(
  adapter: RegistryReadAdapter
): Promise<StoredFieldGroupTables> {
  const tables = new Map<string, string>();
  try {
    const registryTable = await resolveFieldGroupRegistryName(adapter);
    const rows = await adapter.queryStatement<{
      slug?: unknown;
      table_name?: unknown;
    }>(
      sql`SELECT ${sql.identifier("slug")}, ${sql.identifier("table_name")} FROM ${sql.identifier(registryTable)}`
    );
    for (const row of rows) {
      if (typeof row.slug === "string" && typeof row.table_name === "string") {
        tables.set(row.slug, row.table_name);
      }
    }
    return { tables, usable: true, naming: namingOfRegistry(registryTable) };
  } catch (error) {
    // The reason travels with the verdict. Without it the caller can only say
    // "could not read stored field-group table names", which tells an operator
    // nothing about whether they are looking at a permission problem, a dropped
    // connection, or a malformed row — and this is the failure that defers a
    // whole reload, so it is the one worth diagnosing.
    return {
      tables,
      usable: (await registryIsAbsent(adapter)) === true,
      naming: "legacy",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Whether the database genuinely has no field-group registry.
 *
 * The distinction that matters after a failed read: absent means a fresh
 * database, where deriving names is correct; present-but-unreadable means the
 * names are unknown, and deriving them would address storage that is not there.
 * Answered `undefined` when even this cannot be established, which is treated
 * as unreadable.
 */
async function registryIsAbsent(
  adapter: RegistryReadAdapter
): Promise<boolean | undefined> {
  try {
    // Matched under the server's own rules, not by exact spelling — the same
    // way `chooseRegistryTable` matches. A folding server can report the
    // registry as `DYNAMIC_FIELD_GROUPS`, and an exact comparison would call a
    // present registry absent: the caller would then treat derived `comp_*`
    // names as usable and let the reload build them beside the populated
    // migrated tables, which is precisely the outcome this probe exists to
    // prevent.
    const rules = await readIdentifierCaseRules(adapter);
    const catalog = indexCatalog(await adapter.listTables(), rules.tables);
    return (
      resolveCatalogName(catalog, STORAGE_FORMAT.registryTable) === undefined &&
      resolveCatalogName(catalog, MIGRATION_TARGET.registryTable) === undefined
    );
  } catch {
    return undefined;
  }
}

/**
 * The table each declared field group is stored in, by slug: its registry row's, or for a group
 * the registry does not hold yet, the one it is created under on this site. Undefined where no
 * group is declared or the registry cannot be read, so a caller derives names as it did before.
 */
export async function declaredFieldGroupTables(
  adapter: RegistryReadAdapter,
  fieldGroups: readonly unknown[] | undefined
): Promise<Map<string, string> | undefined> {
  const slugs = (fieldGroups ?? [])
    .map(group => (group as { slug?: unknown }).slug)
    .filter((slug): slug is string => typeof slug === "string");
  if (slugs.length === 0) return undefined;
  const stored = await readStoredFieldGroupTables(adapter);
  if (!stored.usable) return undefined;
  return new Map(slugs.map(slug => [slug, storedOrNewTableName(stored, slug)]));
}
