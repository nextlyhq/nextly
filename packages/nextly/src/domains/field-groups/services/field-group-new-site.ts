/**
 * A new site starts its field groups on the current names, so it never needs the storage
 * migration.
 *
 * Two steps, taken by the path that sets an empty database up and only by it:
 *
 * 1. The core tables it creates name the registry `dynamic_field_groups`, not
 *    `dynamic_components` ({@link withFieldGroupRegistryFor}). Every group created afterwards then
 *    reads the site as being on the current names (`field-group-storage-names`).
 * 2. The storage migration's marker records the site as settled on the current generation
 *    ({@link recordNewSiteOnCurrentNames}). Without it, `migrate:field-groups` would find migrated
 *    names that no recorded run accounts for, and refuse rather than say there is nothing to do.
 *
 * 🔴 "Empty" is decided by the path that creates the core tables, from its own probe that the
 * database holds none. The shared catalog reader keeps answering "legacy" for a database that holds
 * neither registry, because a listing filtered by privileges reads the same way, and creating a
 * second registry beside a live one there would hide every group.
 *
 * @module domains/field-groups/services/field-group-new-site
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { Logger } from "../../../services/shared";
import { MetaService } from "../../meta/services/meta-service";
import { settleMigration } from "../migration/state";
import { MIGRATION_TARGET } from "../migration/target";
import { buildFieldGroupRegistryTable } from "../storage/registry-schemas";
import { forgetFieldGroupStorageNames } from "../storage/resolve-storage-names";

import type { FieldGroupNaming } from "./field-group-storage-names";

/** The key a dialect's table bundle declares the field-group registry under. */
const REGISTRY_KEY = "dynamicFieldGroups";

/**
 * A core table bundle with the field-group registry declared under `naming`'s name.
 *
 * Swapped, never added: a bundle declaring both names would create both registries. A bundle that
 * declares no registry is returned as it is.
 */
export function withFieldGroupRegistryFor(
  dialect: SupportedDialect,
  bundle: Record<string, unknown>,
  naming: FieldGroupNaming
): Record<string, unknown> {
  if (naming === "legacy" || !(REGISTRY_KEY in bundle)) return bundle;
  return {
    ...bundle,
    [REGISTRY_KEY]: buildFieldGroupRegistryTable(
      dialect,
      MIGRATION_TARGET.registryTable
    ),
  };
}

/**
 * The names of the registry a database already holds, or undefined where it holds neither: what a
 * setup keeps, so a database with a registry is never given a second one. The legacy registry
 * first, as every reader that finds both takes it.
 */
export async function standingRegistryNaming(adapter: {
  tableExists(table: string): Promise<boolean>;
}): Promise<FieldGroupNaming | undefined> {
  if (await adapter.tableExists(STORAGE_FORMAT.registryTable)) return "legacy";
  if (await adapter.tableExists(MIGRATION_TARGET.registryTable)) {
    return "current";
  }
  return undefined;
}

/**
 * Record that a new site's field-group storage is on the current names.
 *
 * Written as the storage migration writes its own end state: settled on the current generation,
 * with a recorded plan. The plan holds the registry's move alone, the one entry every recorded plan
 * carries, because nothing else was ever on the legacy names to move.
 *
 * The site has just been set up, so the process's resolution of the registry name is dropped as
 * well, even where the record fails: anything read before the core tables existed resolved to the
 * legacy name.
 */
export async function recordNewSiteOnCurrentNames(
  adapter: DrizzleAdapter,
  logger: Logger
): Promise<void> {
  try {
    await settleMigration(new MetaService(adapter, logger), {
      generation: "field-groups-v2",
      appliedManifest: [
        {
          kind: "registry",
          from: STORAGE_FORMAT.registryTable,
          to: MIGRATION_TARGET.registryTable,
        },
      ],
    });
  } finally {
    // Whether or not the record is written: the current registry exists either way, and a stale
    // legacy name would address a registry the database does not have for the rest of the start.
    forgetFieldGroupStorageNames(adapter);
  }
}

/**
 * {@link recordNewSiteOnCurrentNames}, reported rather than thrown where it fails. The storage is
 * on the current names either way and the site serves, so a setup whose tables already exist is
 * not failed over it: only `migrate:field-groups` refuses the site until it is recorded.
 */
export async function recordNewSiteOrWarn(
  adapter: DrizzleAdapter,
  logger: Logger
): Promise<void> {
  try {
    await recordNewSiteOnCurrentNames(adapter, logger);
  } catch (err) {
    logger.warn(
      `[nextly] Could not record that this new site's field groups use the current storage names (${err instanceof Error ? err.message : String(err)}). \`nextly migrate:field-groups\` will refuse to run until it is recorded.`
    );
  }
}
