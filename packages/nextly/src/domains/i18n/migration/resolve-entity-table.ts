/**
 * Map an entity slug to the physical companion `_locales` table that holds its translations.
 *
 * `nextly_i18n_archive` records the entity SLUG (that is what the disable migration writes), but
 * replaying rows needs the physical table. This bridges the two, using the same naming rules
 * migrate:create uses when it builds the desired snapshot: an explicit `dbName` wins, otherwise
 * the per-kind prefix convention applies and dashes become underscores.
 *
 * Kept in the domain rather than the CLI so it is testable without importing the CLI program
 * (and reusable by any other caller that needs the same mapping).
 *
 * @module domains/i18n/migration/resolve-entity-table
 */

import { STORAGE_FORMAT } from "../../../schemas/storage-format";

/** The minimal entity shape this needs from a loaded config. */
export interface EntityLike {
  slug?: string;
  /** Explicit physical table name override, when the entity declares one. */
  dbName?: string;
}

/**
 * The config surface this reads.
 *
 * Field groups arrive under two different keys: an authored config supplies
 * `fieldGroups`, while the persisted UI-schema manifest still spells the key
 * `components`. Both are accepted because this resolver is handed each in turn.
 */
export interface ConfigLike {
  collections?: unknown[];
  singles?: unknown[];
  fieldGroups?: unknown[];
  components?: unknown[];
}

export interface ResolvedEntityTable {
  /** Physical main table, e.g. `dc_pages`. */
  tableName: string;
  /** Physical companion table, e.g. `dc_pages_locales`. */
  companionTableName: string;
  /** Which group the slug was found in (for reporting). */
  kind: "collection" | "single" | "component";
}

/** Table-name prefix per entity kind — mirrors migrate-create's `toMinimalEntities`. */
const GROUPS: [
  readonly (keyof ConfigLike)[],
  "dc_" | "single_" | typeof STORAGE_FORMAT.tablePrefix,
  ResolvedEntityTable["kind"],
][] = [
  [["collections"], "dc_", "collection"],
  [["singles"], "single_", "single"],
  [["fieldGroups", "components"], STORAGE_FORMAT.tablePrefix, "component"],
];

/**
 * Resolve `slug` to its main + companion table, or `null` when no entity of that slug exists in
 * the config. Collections are searched first, then singles, then components.
 */
export function resolveEntityTable(
  config: ConfigLike,
  slug: string
): ResolvedEntityTable | null {
  for (const [keys, prefix, kind] of GROUPS) {
    // Both spellings are consulted for field groups; the first one present wins.
    const entities = keys.flatMap(key => config[key] ?? []);
    for (const raw of entities) {
      const e = raw as EntityLike;
      if (e.slug !== slug) continue;
      const tableName = e.dbName ?? `${prefix}${slug.replace(/-/g, "_")}`;
      return {
        tableName,
        companionTableName: `${tableName}_locales`,
        kind,
      };
    }
  }
  return null;
}
