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

import type { I18nTransitionKind } from "./transition-state";

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
  /** Which group the slug was found in, spelled as the archive records it. */
  kind: I18nTransitionKind;
}

/** Table-name prefix per entity kind — mirrors migrate-create's `toMinimalEntities`. */
const GROUPS: [
  readonly (keyof ConfigLike)[],
  "dc_" | "single_" | typeof STORAGE_FORMAT.tablePrefix,
  ResolvedEntityTable["kind"],
][] = [
  [["collections"], "dc_", "collection"],
  [["singles"], "single_", "single"],
  [["fieldGroups", "components"], STORAGE_FORMAT.tablePrefix, "fieldGroup"],
];

/**
 * Every entity in `config` with this slug, one per kind, in the order collection, Single, field
 * group. Collections and Singles share one namespace of slugs, but a field group's registry is its
 * own, so a slug can name a collection or a Single and a field group at once.
 */
export function resolveEntityTables(
  config: ConfigLike,
  slug: string
): ResolvedEntityTable[] {
  const found: ResolvedEntityTable[] = [];
  for (const [keys, prefix, kind] of GROUPS) {
    // Both spellings are consulted for field groups; the first one present wins.
    const entity = keys
      .flatMap(key => config[key] ?? [])
      .map(raw => raw as EntityLike)
      .find(e => e.slug === slug);
    if (!entity) continue;
    const tableName = entity.dbName ?? `${prefix}${slug.replace(/-/g, "_")}`;
    found.push({
      tableName,
      companionTableName: `${tableName}_locales`,
      kind,
    });
  }
  return found;
}

/** `--kind` as the command line spells each kind. */
const KIND_OPTIONS: Record<string, I18nTransitionKind> = {
  collection: "collection",
  single: "single",
  "field-group": "fieldGroup",
};
const KIND_NAMES: Record<I18nTransitionKind, string> = {
  collection: "collection",
  single: "single",
  fieldGroup: "field group",
};

/**
 * Which of the entities with `slug` a restore means: the one `kind` names, or the only one. A slug
 * that names more than one kind is refused without a `kind`, since restoring one entity's archived
 * values into another's companion is the mistake the kind exists to prevent.
 *
 * @param kind - `--kind` as given: `collection`, `single` or `field-group`
 */
export function chooseRestoreEntity(
  slug: string,
  matches: readonly ResolvedEntityTable[],
  kind?: string
): { entity: ResolvedEntityTable } | { problem: string } {
  if (kind !== undefined) {
    const wanted = KIND_OPTIONS[kind];
    if (wanted === undefined) {
      return {
        problem: `--kind must be collection, single or field-group, not "${kind}".`,
      };
    }
    const entity = matches.find(m => m.kind === wanted);
    return entity
      ? { entity }
      : { problem: `No ${KIND_NAMES[wanted]} named "${slug}" was found.` };
  }
  const [only, ...others] = matches;
  if (only === undefined) {
    return {
      problem: `No collection, single, or field group named "${slug}" was found.`,
    };
  }
  if (others.length === 0) return { entity: only };
  const names = matches.map(m => `a ${KIND_NAMES[m.kind]}`);
  const options = matches.map(
    m =>
      `--kind ${Object.keys(KIND_OPTIONS).find(k => KIND_OPTIONS[k] === m.kind)}`
  );
  return {
    problem:
      `"${slug}" names ${names.slice(0, -1).join(", ")} and ${names.at(-1)}. ` +
      `Say which with ${options.join(" or ")}.`,
  };
}
