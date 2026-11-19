/**
 * The Schema Builder's entities as the boot's storage-layout check judges them: each registry's
 * rows, by their registered tables, beside the entities the configuration declares.
 *
 * @module di/layout-scan-entities
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { resolveFieldGroupRegistryName } from "../domains/field-groups/storage/resolve-storage-names";
import type { LaidOutEntity } from "../domains/i18n/per-language-storage-layout";
import { tableExistsAtStart } from "../domains/schema/pipeline/diff/start-catalog-scope";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../domains/schema/utils/resolve-table-name";
import { resolveSingleTableName } from "../domains/singles/services/resolve-single-table-name";
import { NextlyError } from "../errors/nextly-error";

import { loadDynamicTables } from "./load-dynamic-tables";
import type { StartRegistry } from "./start-reads";

/** The entities a configuration declares, as `declaredLaidOutEntities` reads it. */
export interface DeclaringConfig {
  collections?: readonly { slug: string; fields?: unknown }[];
  singles?: readonly { slug: string; fields?: unknown }[];
  fieldGroups?: readonly { slug: string; fields?: unknown }[];
}

/**
 * Every collection, Single and component the configuration declares, by the table it is stored
 * in: the entities the boot's storage-layout check and `nextly migrate`'s data steps judge
 * alongside the Schema Builder's (`readLayoutScanEntities`). A component's table is
 * `fieldGroupTableOf`'s, by default its name under the earlier naming; a caller that can read the
 * registry passes its stored names (`declaredLaidOutEntitiesAsStored`).
 */
export function declaredLaidOutEntities(
  config: DeclaringConfig,
  fieldGroupTableOf: (slug: string) => string = resolveComponentTableName
): LaidOutEntity[] {
  const fieldsOf = (entity: { fields?: unknown }) =>
    (entity.fields ?? []) as LaidOutEntity["fields"];
  const localizedOf = (entity: object) =>
    (entity as { localized?: unknown }).localized;
  const statusOf = (entity: object) =>
    (entity as { status?: unknown }).status === true;
  const dbNameOf = (entity: object) => (entity as { dbName?: string }).dbName;
  return [
    ...(config.collections ?? []).map(
      (c): LaidOutEntity => ({
        kind: "collection",
        slug: c.slug,
        tableName: resolveCollectionTableName(c.slug, dbNameOf(c)),
        fields: fieldsOf(c),
        localized: localizedOf(c),
        status: statusOf(c),
      })
    ),
    ...(config.singles ?? []).map(
      (s): LaidOutEntity => ({
        kind: "single",
        slug: s.slug,
        tableName: resolveSingleTableName({
          slug: s.slug,
          dbName: dbNameOf(s),
        }),
        fields: fieldsOf(s),
        localized: localizedOf(s),
        status: statusOf(s),
      })
    ),
    ...(config.fieldGroups ?? []).map(
      (g): LaidOutEntity => ({
        kind: "component",
        slug: g.slug,
        tableName: fieldGroupTableOf(g.slug),
        fields: fieldsOf(g),
        localized: localizedOf(g),
      })
    ),
  ];
}

/**
 * `declaredLaidOutEntities`, each declared field group under the table its registry row names, or,
 * for one the registry does not hold yet, its name under the naming this site's storage is on. So
 * a field group is matched with its own registry row rather than judged a second time as a Builder
 * entity, and its real translation table is the one read. The registry is read only when the
 * configuration declares a group; one that cannot be read leaves the earlier naming, for the
 * registry scan (`readLayoutScanEntities`) to refuse naming the registry it could not read.
 */
export async function declaredLaidOutEntitiesAsStored(
  adapter: DrizzleAdapter,
  config: DeclaringConfig
): Promise<LaidOutEntity[]> {
  if ((config.fieldGroups ?? []).length === 0) {
    return declaredLaidOutEntities(config);
  }
  // Loaded only where a group is declared, as the start loads the rest of the layout check.
  const { readStoredFieldGroupTables, storedOrNewTableName } = await import(
    "../domains/field-groups/services/field-group-stored-tables"
  );
  const stored = await readStoredFieldGroupTables(adapter);
  const names = stored.usable
    ? stored
    : { tables: new Map<string, string>(), naming: "legacy" as const };
  return declaredLaidOutEntities(config, slug =>
    storedOrNewTableName(names, slug)
  );
}

/**
 * Every Builder entity a registry holds that the configuration does not declare (`declared`, by
 * table name): one the configuration also declares is judged as the configuration describes it.
 * A registry that is not there yet, as on a fresh database, holds nothing laid out before the
 * setting; one that is there but cannot be read refuses, whatever the setting: the boot's own
 * earlier read of it may have succeeded and registered its entities for one layout, and the scan
 * is what tells whether the database holds the other.
 */
export async function readLayoutScanEntities(
  adapter: DrizzleAdapter,
  declared: ReadonlySet<string>,
  /** The registries a production start read once, when it is one (`di/start-reads`). */
  registry?: StartRegistry
): Promise<LaidOutEntity[]> {
  const entities: LaidOutEntity[] = [];
  const registries: Array<
    [LaidOutEntity["kind"], Parameters<typeof loadDynamicTables>[1]]
  > = [
    ["collection", "dynamic_collections"],
    ["single", "dynamic_singles"],
  ];
  // Which of its two names the component registry carries is a catalog read. One that fails is
  // not a database without components, so it refuses as an unread registry does.
  const fieldGroupRegistry = await resolveFieldGroupRegistryName(adapter).catch(
    (error: unknown) => {
      throw unreadRegistry("component", error);
    }
  );
  if (fieldGroupRegistry) registries.push(["component", fieldGroupRegistry]);
  for (const [kind, registryTable] of registries) {
    // Asked of the catalog, not read off an error: a registry that is not there holds nothing
    // laid out before the setting, and one that is there must be read whole to be judged.
    if (!(await tableExistsAtStart(adapter, registryTable))) continue;
    const { failures } = await loadDynamicTables(
      adapter,
      registryTable,
      (tableName, fields, status, localized, builderOwned, slug) => {
        if (declared.has(tableName)) return Promise.resolve();
        entities.push({
          kind,
          // The slug the registry records, which content and history are addressed by.
          slug,
          tableName,
          fields: fields as LaidOutEntity["fields"],
          localized,
          status,
          ...(builderOwned === undefined ? {} : { builderOwned }),
        });
        return Promise.resolve();
      },
      { registry }
    );
    // The loader records a failed read rather than throwing it, so the entities it could not
    // read would otherwise go unjudged and the boot carry on over them.
    const unread = failures.find(failure => failure.scope === "read");
    if (unread) throw unreadRegistry(registryTable, unread.error);
  }
  return entities;
}

/** The refusal of a boot whose Schema Builder registry (`registry`) could not be read. */
function unreadRegistry(registry: string, error: unknown): NextlyError {
  return new NextlyError({
    code: "NEXTLY_PER_LANGUAGE_STORAGE_MIXED",
    publicMessage:
      `The Schema Builder's ${registry} registry could not be read, so whether its entities ` +
      `keep their translatable values as experimental.perLanguageStorage lays them out cannot ` +
      `be checked. Restart once the database answers.`,
    logContext: {
      registry,
      error: error instanceof Error ? error.message : String(error),
    },
  });
}
