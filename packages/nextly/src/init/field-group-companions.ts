/**
 * A translated field group's translation table, made where it is missing.
 *
 * One place for both callers: a development start's registry load, and the
 * registry reload that follows the migrations at start, the one step of a
 * production start that may define structure. A collection's and a Single's
 * translation tables are made through `registerDynamicEntitySchema`; a field
 * group's registration (`registerComponentSchemas`) makes no table, so the
 * reload asks here for the tables the migrations left missing.
 *
 * @module init/field-group-companions
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { DynamicTableLoadResult } from "../di/load-dynamic-tables";
import { storesPerLanguage } from "../domains/i18n/per-language-storage";
import { builtByFor } from "../domains/schema/pipeline/registered-collections";

/** One field group as its registry row describes it. */
export interface FieldGroupCompanionArgs {
  tableName: string;
  fields: readonly unknown[];
  /** Ownership as the registry reported it; `undefined` where it is too old to say. */
  builderOwned: boolean | undefined;
  dialect: SupportedDialect;
}

/** Make the field group's translation table where it is missing (`ensureCompanionTable`). */
export async function ensureFieldGroupCompanion(
  adapter: DrizzleAdapter,
  args: FieldGroupCompanionArgs
): Promise<void> {
  const { ensureCompanionTable } = await import(
    "../domains/i18n/runtime/companion-io"
  );
  await ensureCompanionTable(adapter, {
    // A field group's own creator sizes a text column from a key of its own, and a
    // code-first row in this registry was not built by it at all.
    builtBy: builtByFor("fieldGroup", args.builderOwned),
    slug: args.tableName,
    tableName: args.tableName,
    fields: args.fields as { name: string; type: string }[],
    dialect: args.dialect,
    status: false,
  });
}

/**
 * Every translated field group's missing translation table, from the field
 * group registry as the database holds it. Answers the loader's outcome, so a
 * caller can tell a row it could not read from one it made.
 */
export async function ensureFieldGroupCompanions(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<DynamicTableLoadResult> {
  const [
    { loadDynamicTables },
    { resolveFieldGroupRegistryName },
    { STORAGE_FORMAT },
  ] = await Promise.all([
    import("../di/load-dynamic-tables"),
    import("../domains/field-groups/storage/resolve-storage-names"),
    import("../schemas/storage-format"),
  ]);
  // Resolved as the registry load resolves it: the storage migration renames
  // the registry, and a database may hold either name.
  const registryName = await resolveFieldGroupRegistryName(adapter).catch(
    () => undefined
  );
  return loadDynamicTables(
    adapter,
    registryName ?? STORAGE_FORMAT.registryTable,
    async (tableName, fields, _hasStatus, localized, builderOwned) => {
      if (!storesPerLanguage({ localized })) return;
      await ensureFieldGroupCompanion(adapter, {
        tableName,
        fields,
        builderOwned,
        dialect,
      });
    }
  );
}
