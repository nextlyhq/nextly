/**
 * What a deleted entity leaves in the tables every entity shares, removed by
 * `nextly migrate` once the entity is gone: its field-group values (rows of
 * the shared `comp_*` tables whose parent is the entity's table) and its
 * translation rows outside its translations table (archived translations,
 * translation provenance and its translation transition record).
 *
 * The Builder's delete in development removes these before it drops the
 * entity's tables. A deployed database receives the delete as a migration
 * file, which drops the tables only, so these stayed, and an entity created
 * later under the same name or table found them as its own.
 *
 * Only an entity an applied migration dropped (`droppedEntities`) whose table
 * and registry row are both gone is touched: an entity whose table stands, or
 * whose row is still registered, is not deleted yet, and its rows are its
 * own. Each entity's rows go in one transaction, so a run stopped part-way
 * through one removes none of its rows, and every later run, finding the
 * entity still gone, removes what is left: deletes made before this existed
 * included. An entity with nothing left is passed over without a word.
 *
 * @module domains/schema/migrate/dropped-entity-leftovers
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import { isReservedResourceSlug } from "../../../schemas/_zod/rbac";
import type { Logger } from "../../../shared/types";
import { teardownAdapterIn } from "../../collections/services/teardown-adapter-in-transaction";
import { teardownEntityComponentData } from "../../field-groups/services/teardown-entity-field-group-data";
import { resolveRegistryTableName } from "../../field-groups/storage/resolve-storage-names";
import { ensureI18nArchive } from "../../i18n/migration/ensure-archive";
import {
  ARCHIVE_TABLE,
  removeEntityTranslationRows,
} from "../../i18n/migration/entity-translation-rows";
import { recordedEntityTable } from "../migrate-create/dropped-translations";
import type {
  EntitySettingsRecord,
  SettingsEntityKind,
} from "../migrate-create/entity-settings";
import { assertSchemaLockHeld } from "../pipeline/schema-lock";

import { droppedEntities, RECORDED_KINDS } from "./registry-history";

/** One dropped entity whose leftovers may remain. */
interface DroppedEntity {
  kind: SettingsEntityKind;
  slug: string;
  table: string;
}

/** The word a run's report names each kind by. */
const KIND_WORDS: Record<SettingsEntityKind, string> = {
  collection: "collection",
  single: "Single",
  fieldGroup: "field group",
};

/**
 * Remove the leftovers of every entity `chain`'s applied migrations dropped
 * whose registry row and table are both gone. Runs under the caller's schema
 * lock, once the registry write that removes this run's dropped rows has
 * committed, and on no transaction of the caller's. Answers one line for each entity it removed rows of, naming the
 * entity and what went. A removal that fails is warned of and leaves that
 * entity's rows for the next run; the others still go.
 */
export async function removeDroppedEntityLeftovers(args: {
  adapter: DrizzleAdapter;
  chain: readonly EntitySettingsRecord[];
  logger: Logger;
  /**
   * Makes every field group's table addressable before any is read, where the
   * caller's adapter resolves Nextly's own tables alone (a command's, which
   * boots no app). Called only when some entity's leftovers are to be removed.
   */
  prepareTables?: () => Promise<void>;
}): Promise<string[]> {
  const { adapter, logger } = args;
  const removedFrom: string[] = [];
  const gone = await goneEntities(args);
  if (gone.length === 0) return removedFrom;
  await args.prepareTables?.();
  // The archive's rows are removed by entity kind, which an archive from
  // before rows recorded it lacks. Bringing it up to date is DDL, which on
  // MySQL commits any transaction, so it runs once here, before any entity's.
  if (await adapter.tableExists(ARCHIVE_TABLE)) {
    await ensureI18nArchive(adapter, adapter.dialect);
  }
  for (const entity of gone) {
    await assertSchemaLockHeld();
    const word = KIND_WORDS[entity.kind];
    try {
      const removed = await adapter.transaction(async tx => {
        const scoped = teardownAdapterIn(adapter, tx);
        const values = await teardownEntityComponentData({
          adapter: scoped,
          parentTable: entity.table,
        });
        const translations = await removeEntityTranslationRows({
          adapter: scoped,
          kind: entity.kind,
          slug: entity.slug,
        });
        return {
          values: values.instancesDeleted,
          translations:
            translations.archiveRowsPurged + translations.provenanceRowsPurged,
        };
      });
      if (removed.values + removed.translations === 0) continue;
      removedFrom.push(
        `${word} "${entity.slug}" left: ${plural(removed.values, "field group value")}, ${plural(removed.translations, "translation row")}`
      );
    } catch (error) {
      logger.warn(
        `Could not remove what the deleted ${word} "${entity.slug}" left: ${causeOf(
          error
        )}. The next \`nextly migrate\` tries again.`
      );
    }
  }
  return removedFrom;
}

/**
 * The dropped entities whose registry row and table are both gone, each with
 * the table the newest record that held it names. One whose table cannot be
 * asked about is passed over, as standing.
 */
async function goneEntities(args: {
  adapter: DrizzleAdapter;
  chain: readonly EntitySettingsRecord[];
}): Promise<DroppedEntity[]> {
  const dropped = droppedEntities(args.chain);
  const gone: DroppedEntity[] = [];
  for (const [kind] of RECORDED_KINDS) {
    for (const slug of dropped[kind]) {
      const table = await goneTableOf(args, kind, slug);
      if (table !== undefined) gone.push({ kind, slug, table });
    }
  }
  return gone;
}

/**
 * The table dropped entity `kind` `slug` was dropped with, where its registry
 * row and that table are both gone; undefined otherwise, for a reserved slug,
 * and where no record names its table.
 */
async function goneTableOf(
  args: { adapter: DrizzleAdapter; chain: readonly EntitySettingsRecord[] },
  kind: SettingsEntityKind,
  slug: string
): Promise<string | undefined> {
  if (isReservedResourceSlug(slug)) return undefined;
  if (await registryHolds(args.adapter, kind, slug)) return undefined;
  // The newest record that held it names the table it was dropped with.
  const key = RECORD_KEYS[kind];
  const entry = [...args.chain].reverse().find(record => slug in record[key])?.[
    key
  ][slug];
  if (entry === undefined) return undefined;
  const table = recordedEntityTable(kind, slug, entry);
  return (await tableStands(args.adapter, table)) ? undefined : table;
}

/** Whether `table` is there; one that cannot be asked about counts as standing. */
async function tableStands(
  adapter: DrizzleAdapter,
  table: string
): Promise<boolean> {
  try {
    return await adapter.tableExists(table);
  } catch {
    return true;
  }
}

/** Where a snapshot's entity record keeps each kind. */
const RECORD_KEYS = Object.fromEntries(RECORDED_KINDS) as Record<
  SettingsEntityKind,
  keyof EntitySettingsRecord
>;

/** The registry table each kind's rows are kept in; a field group's is resolved, as it has two names. */
const REGISTRY_TABLES: Record<
  Exclude<SettingsEntityKind, "fieldGroup">,
  string
> = {
  collection: "dynamic_collections",
  single: "dynamic_singles",
};

/**
 * Whether `kind`'s registry holds a row for `slug`. One that cannot be read
 * answers yes, so an entity it may still register is left as it is.
 */
async function registryHolds(
  adapter: DrizzleAdapter,
  kind: SettingsEntityKind,
  slug: string
): Promise<boolean> {
  try {
    const table =
      kind === "fieldGroup"
        ? await resolveRegistryTableName(adapter)
        : REGISTRY_TABLES[kind];
    const rows = await adapter.select<{ slug: string }>(table, {
      columns: ["slug"],
      where: { and: [{ column: "slug", op: "=", value: slug }] },
    });
    return rows.length > 0;
  } catch {
    return true;
  }
}

function plural(count: number, one: string): string {
  return `${String(count)} ${count === 1 ? one : `${one}s`}`;
}

/**
 * What stopped a removal, for the person running the command: a Nextly error's
 * own account of it (`logMessage`), which its public message leaves out.
 */
function causeOf(error: unknown): string {
  if (error instanceof NextlyError) return error.logMessage ?? error.message;
  return error instanceof Error ? error.message : String(error);
}
