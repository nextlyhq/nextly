/**
 * The Schema Builder's entities as the boot's storage-layout check judges them: each registry's
 * rows, by their registered tables, beside the entities the configuration declares.
 *
 * @module di/layout-scan-entities
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { resolveFieldGroupRegistryName } from "../domains/field-groups/storage/resolve-storage-names";
import type { LaidOutEntity } from "../domains/i18n/per-language-storage-layout";
import { NextlyError } from "../errors/nextly-error";

import { loadDynamicTables } from "./load-dynamic-tables";

/**
 * Every Builder entity a registry holds that the configuration does not declare (`declared`, by
 * table name): one the configuration also declares is judged as the configuration describes it.
 * A registry that is not there yet, as on a fresh database, holds nothing laid out before the
 * setting; one that is there but cannot be read refuses under the setting, since its entities
 * cannot be judged.
 */
export async function readLayoutScanEntities(
  adapter: DrizzleAdapter,
  declared: ReadonlySet<string>,
  // Whether the setting is on. Only then does an unread registry refuse: boot would register its
  // entities per language over values their main tables may still hold, and serve those blank.
  // With it off an unread entity is not registered at all, so there is nothing to protect.
  perLanguage: boolean
): Promise<LaidOutEntity[]> {
  const entities: LaidOutEntity[] = [];
  const registries: Array<
    [LaidOutEntity["kind"], Parameters<typeof loadDynamicTables>[1]]
  > = [
    ["collection", "dynamic_collections"],
    ["single", "dynamic_singles"],
  ];
  const fieldGroupRegistry = await resolveFieldGroupRegistryName(adapter).catch(
    () => undefined
  );
  if (fieldGroupRegistry) registries.push(["component", fieldGroupRegistry]);
  for (const [kind, registry] of registries) {
    // Asked of the catalog, not read off an error: a registry that is not there holds nothing
    // laid out before the setting, and one that is there must be read whole to be judged.
    if (!(await adapter.tableExists(registry))) continue;
    const { failures } = await loadDynamicTables(
      adapter,
      registry,
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
      }
    );
    // The loader records a failed read rather than throwing it, so the entities it could not
    // read would otherwise go unjudged and the boot carry on over them.
    const unread = failures.find(failure => failure.scope === "read");
    if (unread && perLanguage) {
      throw new NextlyError({
        code: "NEXTLY_PER_LANGUAGE_STORAGE_MIXED",
        publicMessage:
          `The Schema Builder's ${registry} registry could not be read, so whether its ` +
          `entities keep their translatable values as experimental.perLanguageStorage lays ` +
          `them out cannot be checked. Restart once the database answers.`,
        logContext: {
          registry,
          error:
            unread.error instanceof Error
              ? unread.error.message
              : String(unread.error),
        },
      });
    }
  }
  return entities;
}
