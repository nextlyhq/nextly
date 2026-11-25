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
 * Only an entity an applied migration dropped (`droppedEntities`) is touched,
 * and only once nothing can still own what it left: its registry row is gone,
 * and every table it was ever recorded with is gone and claimed by no entity
 * the newest record holds or any registry row names. Rows parented to a table
 * that stands, or that another entity has taken, may be that entity's. Each
 * entity's rows go in one transaction, so a run stopped part-way through one
 * removes none of its rows, and every later run, finding the entity still
 * gone, removes what is left: deletes made before this existed included. An
 * entity with nothing left is passed over without a word.
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
import { COMPANION_KEY_COLUMNS } from "../../i18n/companion-columns";
import { ensureI18nArchive } from "../../i18n/migration/ensure-archive";
import {
  ARCHIVE_TABLE,
  removeEntityTranslationRows,
} from "../../i18n/migration/entity-translation-rows";
import { dropTranslationsTable } from "../../i18n/migration/teardown-entity-i18n";
import { recordedEntityTables } from "../migrate-create/dropped-translations";
import type {
  EntitySettingsRecord,
  SettingsEntityKind,
} from "../migrate-create/entity-settings";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
import { readForeignKeyTargets } from "../pipeline/live-table-facts";
import { assertSchemaLockHeld } from "../pipeline/schema-lock";

import { droppedEntities, RECORDED_KINDS } from "./registry-history";
import { endsTheRun, reachStopPoint } from "./stop-points";

/** One dropped entity whose leftovers may remain, with every table it was recorded with. */
interface DroppedEntity {
  kind: SettingsEntityKind;
  slug: string;
  tables: readonly string[];
}

/** The word a run's report names each kind by. */
const KIND_WORDS: Record<SettingsEntityKind, string> = {
  collection: "collection",
  single: "Single",
  fieldGroup: "field group",
};

/** Where a snapshot's entity record keeps each kind. */
const RECORD_KEYS = Object.fromEntries(RECORDED_KINDS) as Record<
  SettingsEntityKind,
  keyof EntitySettingsRecord
>;

/**
 * Remove the leftovers of every entity `chain`'s applied migrations dropped
 * that nothing can still own (above). Runs under the caller's schema lock,
 * once the registry write that removes this run's dropped rows has committed,
 * and on no transaction of the caller's. Answers one line for each entity it
 * removed rows of, naming the entity and what went (`removed`), and names each
 * entity whose removal failed (`left`): that removal is warned of and leaves
 * the entity's rows for the next run; the others still go.
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
  /**
   * The translations tables dropped entities left standing that the run's
   * data-loss consent covers (`leftoverTranslationsTables`, judged with the
   * run's other deletions): each is dropped before its entity's rows go. None
   * is dropped where none is given, as at a development start.
   */
  dropTranslations?: ReadonlySet<string>;
}): Promise<{ removed: string[]; left: string[] }> {
  const { adapter, logger } = args;
  const removedFrom: string[] = [];
  const left: string[] = [];
  const gone = await goneEntities(args);
  if (gone.length === 0) return { removed: removedFrom, left };
  await args.prepareTables?.();
  // The archive's rows are removed by entity kind, which an archive from
  // before rows recorded it lacks. Bringing it up to date is DDL, which on
  // MySQL commits any transaction, so it runs once here, before any entity's,
  // and only while this run still holds the schema lock.
  if (await adapter.tableExists(ARCHIVE_TABLE)) {
    await assertSchemaLockHeld();
    await ensureI18nArchive(adapter, adapter.dialect);
  }
  for (const entity of gone) {
    await assertSchemaLockHeld();
    const word = KIND_WORDS[entity.kind];
    // The translations tables dropped, kept outside the removal's try: a drop
    // is not undone by a later failure, so it is reported either way.
    const dropped: string[] = [];
    try {
      // A translations table is a table: dropped on its own, ahead of the rows'
      // transaction, which on MySQL a schema statement inside would commit.
      await dropCoveredTranslations(
        adapter,
        entity,
        args.dropTranslations,
        dropped,
        logger
      );
      const removed = await adapter.transaction(async tx => {
        const scoped = teardownAdapterIn(adapter, tx);
        let values = 0;
        for (const table of entity.tables) {
          values += (
            await teardownEntityComponentData({
              adapter: scoped,
              parentTable: table,
            })
          ).instancesDeleted;
        }
        await reachStopPoint(
          `${entity.kind} ${entity.slug}: removed fieldGroupValues`
        );
        // Not labelled here: the entity's registry row is gone, and the pass labelled what it could
        // before the registry write, where every holder was in place (`labelArchiveWhileRegistered`).
        const translations = await removeEntityTranslationRows({
          adapter: scoped,
          kind: entity.kind,
          slug: entity.slug,
          labelLegacy: false,
        });
        await reachStopPoint(
          `${entity.kind} ${entity.slug}: removed translationRows`
        );
        return {
          values,
          translations:
            translations.archiveRowsPurged +
            translations.provenanceRowsPurged +
            translations.sourceRowsPurged +
            translations.transitionRecordsPurged,
        };
      });
      // The entity's transaction has committed (`stop-points.ts`).
      await reachStopPoint(`${entity.kind} ${entity.slug}: removed leftovers`);
      if (removed.values + removed.translations + dropped.length === 0) {
        continue;
      }
      removedFrom.push(
        removedLine(word, entity.slug, [
          ...droppedParts(dropped),
          plural(removed.values, "field group value"),
          plural(removed.translations, "translation row"),
        ])
      );
    } catch (error) {
      // A run that lost the schema lock stops: it may change nothing further, and the caller
      // must not go on as if only this entity's removal had failed. So does a test's stop at a
      // point (`stop-points.ts`).
      if (endsTheRun(error)) throw error;
      left.push(`${word} "${entity.slug}"`);
      if (dropped.length > 0) {
        removedFrom.push(removedLine(word, entity.slug, droppedParts(dropped)));
      }
      logger.warn(
        `Could not remove what the deleted ${word} "${entity.slug}" left: ${causeOf(
          error
        )}. The next \`nextly migrate\` tries again.`
      );
    }
  }
  return { removed: removedFrom, left };
}

/**
 * Drops each of `entity`'s translations tables `covered` names (the run's
 * consent covers them), adding each one dropped to `dropped` as it goes, so a
 * later failure still finds the ones that went.
 */
async function dropCoveredTranslations(
  adapter: DrizzleAdapter,
  entity: DroppedEntity,
  covered: ReadonlySet<string> | undefined,
  dropped: string[],
  logger: Logger
): Promise<void> {
  for (const table of entity.tables) {
    const translations = `${table}_locales`;
    if (covered?.has(translations) !== true) continue;
    // Proven again right before the drop, as the run was asked about it: a migration of this run
    // may have dropped that table and made another under its name.
    if (!(await keyedAsTranslations(adapter, translations))) {
      logger.warn(
        `Left table ${JSON.stringify(translations)} as it is: it is no longer the translations table the deleted ${KIND_WORDS[entity.kind]} "${entity.slug}" left, which the run was asked about.`
      );
      continue;
    }
    if (
      await dropTranslationsTable(
        adapter,
        table,
        "the removal of what a deleted entity left",
        // Only the table was consented to: a view or another table's key on it refuses the drop.
        { cascade: false }
      )
    ) {
      dropped.push(translations);
    }
  }
}

/** The report's words for the translations tables dropped. */
function droppedParts(dropped: readonly string[]): string[] {
  return dropped.map(table => `its translations table ${table}`);
}

/** One report line: the entity, and what of what it left went. */
function removedLine(
  word: string,
  slug: string,
  parts: readonly string[]
): string {
  return `${word} "${slug}" left: ${parts.join(", ")}`;
}

/** A translations table a dropped entity left standing, with the entity and the table it translated. */
export interface LeftoverTranslations {
  kind: SettingsEntityKind;
  slug: string;
  table: string;
  translates: string;
}

/**
 * The translations tables (`<table>_locales`) entities nothing can still own
 * left standing (`goneEntities`): an older PostgreSQL delete dropped the
 * entity's table with `CASCADE`, which takes only the translations table's
 * key to it, and left the translations table with every translation in it.
 * Each is proven the entity's by its name, after a table the applied history
 * recorded for the dropped entity, and by `_parent` and `_locale`, the key
 * every translations table is made with (a field's column never starts with
 * `_`). Dropping one deletes data, so the command judges these with its other
 * deletions under the data-loss consent before anything runs.
 */
export async function leftoverTranslationsTables(args: {
  adapter: DrizzleAdapter;
  chain: readonly EntitySettingsRecord[];
}): Promise<LeftoverTranslations[]> {
  const out: LeftoverTranslations[] = [];
  for (const entity of await goneEntities(args)) {
    for (const main of entity.tables) {
      const table = `${main}_locales`;
      if (!(await tableStands(args.adapter, table))) continue;
      if (!(await keyedAsTranslations(args.adapter, table))) continue;
      out.push({
        kind: entity.kind,
        slug: entity.slug,
        table,
        translates: main,
      });
    }
  }
  return out;
}

/**
 * Whether live `table` is a translations table an older delete left: keyed by `_parent` and
 * `_locale` alone, with no key from `_parent` to any table. One that cannot be read is not.
 */
async function keyedAsTranslations(
  adapter: DrizzleAdapter,
  table: string
): Promise<boolean> {
  try {
    const live = await introspectLiveColumns(
      adapter.getDrizzle(),
      adapter.dialect,
      [table]
    );
    // Its primary key exactly the pair every translations table is made with (`PRIMARY KEY
    // (_parent, _locale)`): columns of those names on a table that is keyed otherwise do not make
    // it one, and dropping it is not undone.
    const key = new Set(
      (live.tables.find(t => t.name === table)?.columns ?? [])
        .filter(column => column.primaryKey === true)
        .map(column => column.name)
    );
    if (
      key.size !== COMPANION_KEY_COLUMNS.length ||
      !COMPANION_KEY_COLUMNS.every(column => key.has(column))
    ) {
      return false;
    }
    // And no key from `_parent` to any table: an older delete's drop of the main table took the
    // one it had, so a table of this name whose `_parent` points somewhere was made since.
    const keys = await readForeignKeyTargets(
      adapter.getDrizzle(),
      adapter.dialect,
      table
    );
    return (keys.get(COMPANION_KEY_COLUMNS[0] ?? "_parent") ?? []).length === 0;
  } catch {
    return false;
  }
}

/**
 * Every table `kind` `slug` was recorded with along `chain`, newest first,
 * each once: an entity deleted, made again under the same slug with another
 * table, and deleted again left rows under both.
 */
export function recordedTablesOf(
  chain: readonly EntitySettingsRecord[],
  kind: SettingsEntityKind,
  slug: string
): string[] {
  const key = RECORD_KEYS[kind];
  const tables = new Set<string>();
  for (const record of [...chain].reverse()) {
    const entry = record[key][slug];
    if (entry === undefined) continue;
    for (const table of recordedEntityTables(kind, slug, entry)) {
      tables.add(table);
    }
  }
  return [...tables];
}

/**
 * The tables the entities `record` holds are recorded with: a table one of
 * them names is that entity's, whatever entity named it before.
 */
export function tablesHeldBy(record: EntitySettingsRecord): Set<string> {
  const tables = new Set<string>();
  for (const [kind, key] of RECORDED_KINDS) {
    for (const [slug, entry] of Object.entries(record[key])) {
      for (const table of recordedEntityTables(kind, slug, entry)) {
        tables.add(table);
      }
    }
  }
  return tables;
}

/**
 * The dropped entities nothing can still own: each whose registry row is
 * gone and whose every recorded table is gone and claimed by no entity of
 * the newest record and no registry row. Anything that cannot be read counts
 * as owned, and its entity is passed over.
 */
async function goneEntities(args: {
  adapter: DrizzleAdapter;
  chain: readonly EntitySettingsRecord[];
}): Promise<DroppedEntity[]> {
  const dropped = droppedEntities(args.chain);
  const newest = args.chain.at(-1);
  const held = newest === undefined ? new Set<string>() : tablesHeldBy(newest);
  const gone: DroppedEntity[] = [];
  for (const [kind] of RECORDED_KINDS) {
    for (const slug of dropped[kind]) {
      const entity = await goneEntityOf(args, held, kind, slug);
      if (entity !== undefined) gone.push(entity);
    }
  }
  return gone;
}

/**
 * Dropped entity `kind` `slug`, with every table it was recorded with, where
 * nothing can still own what it left; undefined otherwise, and for a
 * reserved slug.
 */
async function goneEntityOf(
  args: { adapter: DrizzleAdapter; chain: readonly EntitySettingsRecord[] },
  held: ReadonlySet<string>,
  kind: SettingsEntityKind,
  slug: string
): Promise<DroppedEntity | undefined> {
  if (isReservedResourceSlug(slug)) return undefined;
  if (await registryHolds(args.adapter, kind, "slug", slug)) return undefined;
  const tables = recordedTablesOf(args.chain, kind, slug);
  if (tables.length === 0) return undefined;
  if (await anyTableOwned(args.adapter, tables, held)) return undefined;
  return { kind, slug, tables };
}

/**
 * Whether any of `tables` may still be owned: it stands, the newest record's
 * entities hold it, or a registry row names it.
 */
async function anyTableOwned(
  adapter: DrizzleAdapter,
  tables: readonly string[],
  held: ReadonlySet<string>
): Promise<boolean> {
  for (const table of tables) {
    if (held.has(table) || (await tableStands(adapter, table))) return true;
    for (const [kind] of RECORDED_KINDS) {
      if (await registryHolds(adapter, kind, "tableName", table)) return true;
    }
  }
  return false;
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

/** The registry table each kind's rows are kept in; a field group's is resolved, as it has two names. */
const REGISTRY_TABLES: Record<
  Exclude<SettingsEntityKind, "fieldGroup">,
  string
> = {
  collection: "dynamic_collections",
  single: "dynamic_singles",
};

/**
 * Whether `kind`'s registry holds a row whose `column` is `value`: its slug,
 * or the table it names. One that cannot be read answers yes, so an entity it
 * may still register is left as it is.
 */
async function registryHolds(
  adapter: DrizzleAdapter,
  kind: SettingsEntityKind,
  column: "slug" | "tableName",
  value: string
): Promise<boolean> {
  return (await readRegistryHolds(adapter, kind, column, value)) ?? true;
}

/** Whether `kind`'s registry has a row whose `column` is `value`; undefined when it cannot be read. */
async function readRegistryHolds(
  adapter: DrizzleAdapter,
  kind: SettingsEntityKind,
  column: "slug" | "tableName",
  value: string
): Promise<boolean | undefined> {
  try {
    const table =
      kind === "fieldGroup"
        ? await resolveRegistryTableName(adapter)
        : REGISTRY_TABLES[kind];
    if (!(await adapter.tableExists(table))) return false;
    const rows = await adapter.select<{ slug: string }>(table, {
      columns: ["slug"],
      where: { and: [{ column, op: "=", value }] },
    });
    return rows.length > 0;
  } catch {
    return undefined;
  }
}

/**
 * Whether the registries hold a row for every entity `record` lists, by its slug: where one is
 * missing, a registry write from `record` adds it. False where a registry cannot be read, so a
 * caller waiting for every holder to be in place waits.
 */
export async function everyEntityRegistered(
  adapter: DrizzleAdapter,
  record: EntitySettingsRecord
): Promise<boolean> {
  for (const [kind, key] of RECORDED_KINDS) {
    for (const slug of Object.keys(record[key])) {
      if (isReservedResourceSlug(slug)) continue;
      if ((await readRegistryHolds(adapter, kind, "slug", slug)) !== true) {
        return false;
      }
    }
  }
  return true;
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
