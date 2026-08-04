/**
 * What a reload has decided about each field group, in one place.
 *
 * A reload makes several decisions per group — where it is stored, whether its
 * storage could be established at all, and therefore whether this pass may
 * touch it — and every later stage needs the same answer. Held apart from the
 * reload itself because they were previously re-derived at each stage, and a
 * decision applied at one stage and not the next is the defect that shape
 * produces: skipping a group's DDL while still persisting its new field list
 * leaves the registry describing columns the table does not have.
 *
 * The rule the whole module exists to enforce:
 *
 * > A derived name is a guess about physical storage, and guessing is what
 * > creates an empty table beside the populated one the reload meant to edit.
 *
 * @module init/field-group-reload-plan
 */

import { sql, type SQL } from "drizzle-orm";

import { MIGRATION_TARGET } from "../domains/field-groups/migration/manifest";
import { resolveFieldGroupRegistryName } from "../domains/field-groups/storage/resolve-storage-names";
import { readIdentifierCaseRules } from "../domains/schema/utils/read-identifier-case";
import {
  indexCatalog,
  resolveCatalogName,
} from "../domains/schema/utils/resolve-catalog-name";
import { resolveComponentTableName } from "../domains/schema/utils/resolve-table-name";
import { STORAGE_FORMAT } from "../schemas/storage-format";

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

/** A field group as the config declares it, reduced to what a reload reads. */
export interface FieldGroupDef {
  slug?: string;
  fields?: unknown[];
  localized?: boolean;
}

/** A field's shape as the schema diff consumes it. */
export interface MinimalField {
  name: string;
  type: string;
  required?: boolean;
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
   * Why the read failed, when it did.
   *
   * Present only on the failure path, and carried so the caller's log can name
   * the cause rather than only the symptom.
   */
  reason?: string;
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
    return { tables, usable: true };
  } catch (error) {
    // The reason travels with the verdict. Without it the caller can only say
    // "could not read stored field-group table names", which tells an operator
    // nothing about whether they are looking at a permission problem, a dropped
    // connection, or a malformed row — and this is the failure that defers a
    // whole reload, so it is the one worth diagnosing.
    return {
      tables,
      usable: (await registryIsAbsent(adapter)) === true,
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

/** One field group this reload will address, with its stored physical name. */
export interface FieldGroupReloadTarget {
  slug: string;
  tableName: string;
  fields: MinimalField[];
  localized?: boolean;
}

/** Every decision this reload has made about its field groups. */
export interface FieldGroupReloadPlan {
  /** The groups this pass may touch. */
  targets: FieldGroupReloadTarget[];
  /**
   * Slugs left out because their storage could not be established.
   *
   * 🔴 Every stage that acts on a field group has to consult this, not only the
   * one that emits DDL. Skipping a group's schema change while still persisting
   * its new `fields` is worse than doing neither: the registry would describe
   * columns the table does not have, and the next start would build a runtime
   * schema from that description and fail every read and write for it.
   */
  skipped: Set<string>;
  /** Whether the stored names could be read at all. */
  usable: boolean;
  /** Why they could not, when they could not. */
  reason?: string;
}

/**
 * Decide, once, what this reload will do with each field group.
 *
 * Best effort by design on the read: a registry that cannot be read leaves
 * every name derived, which is exactly the behaviour of a database that has no
 * registry yet — and a registry that is present but unreadable leaves every
 * group SKIPPED, because there a derived name would address storage that is
 * not there.
 */
export async function planFieldGroupReload(
  adapter: RegistryReadAdapter,
  fieldGroups: readonly FieldGroupDef[]
): Promise<FieldGroupReloadPlan> {
  const stored = await readStoredFieldGroupTables(adapter);
  const targets: FieldGroupReloadTarget[] = [];
  const skipped = new Set<string>();

  for (const group of fieldGroups) {
    if (!group.slug) continue;
    if (!stored.usable) {
      skipped.add(group.slug);
      continue;
    }
    targets.push({
      slug: group.slug,
      tableName:
        stored.tables.get(group.slug) ?? resolveComponentTableName(group.slug),
      fields: (group.fields ?? []) as MinimalField[],
      // Carried so the diff omits translatable columns from the group's main
      // table and registers its companion.
      localized: group.localized === true,
    });
  }

  return { targets, skipped, usable: stored.usable, reason: stored.reason };
}
