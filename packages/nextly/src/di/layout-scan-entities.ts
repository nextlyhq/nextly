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
import { NextlyError } from "../errors/nextly-error";

import { loadDynamicTables } from "./load-dynamic-tables";
import type { StartRegistry } from "./start-reads";

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
      (tableName, fields, _status, localized) => {
        if (declared.has(tableName)) return Promise.resolve();
        entities.push({
          kind,
          slug: tableName,
          tableName,
          fields: fields as LaidOutEntity["fields"],
          localized,
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
