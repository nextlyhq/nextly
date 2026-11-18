/**
 * What `migrate:create` generates an app migration from: the config's
 * entities, the Schema Builder's, their registry rows, the app's extension
 * tables and the latest snapshot, each checked as a migration needs it.
 *
 * One preparation for every writer of an app migration: `migrate:create`, and
 * the server when a Schema Builder save writes its collection's migration. Two
 * would drift, and the migration each wrote would then differ for the same
 * declaration. Every refusal is thrown; the caller reports it.
 *
 * @module domains/schema/migrate-create/app-migration-inputs
 */
import { resolve } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { SanitizedNextlyConfig } from "../../../collections/config/define-config";
import type { DeferredExtend } from "../../../plugins/schema/apply-contributions";
import type {
  UiSchemaEntity,
  UiSchemaManifest,
} from "../../../schemas/_zod/ui-schema";
import { assertPluginFieldDeclarations } from "../../../shared/lib/assert-plugin-field-declarations";
import {
  storageNamesFor,
  underNaming,
  type FieldGroupNaming,
  type FieldGroupStorageNames,
} from "../../field-groups/services/field-group-storage-names";
import {
  judgeBuilderDefinitions,
  readBuilderDefinitions,
} from "../ui-schema/builder-definitions";
import {
  buildCollectionMetadataUpsert,
  buildComponentMetadataUpsert,
  buildSingleMetadataUpsert,
} from "../ui-schema/metadata-sql";

import { assertMigrationAddresses, type JudgedEntity } from "./addresses";
import {
  compileAppStreamTables,
  hasAppStreamTables,
  type AppStreamTables,
} from "./app-stream";
import type { EntitySettingsRecord, SettingsObject } from "./entity-settings";
import { removedEntityTables, type MinimalConfigEntity } from "./generate";
import { assertMigrationSiblingFields } from "./sibling-fields";
import {
  EMPTY_SNAPSHOT,
  loadLatestSnapshot,
  snapshotFieldGroupNaming,
  type SnapshotFile,
} from "./snapshot-io";

/**
 * The parts of the app's config a migration is generated from: the code-first
 * entities, the plugins whose extension schema rides the app's stream, the
 * default language and the two paths. Narrower than the whole config so the
 * running app's plugin-transformed config, which a Schema Builder save reads,
 * is one too.
 */
export type AppMigrationConfig = Pick<
  SanitizedNextlyConfig,
  "collections" | "singles" | "fieldGroups" | "plugins" | "localization"
> & {
  db: Pick<SanitizedNextlyConfig["db"], "uiSchemaFile" | "migrationsDir">;
};

/** What `appMigrationInputs` is asked with. */
export interface AppMigrationInputsArgs {
  config: AppMigrationConfig;
  /** Plugin extends whose target is a Schema Builder entity, as the config loader left them. */
  deferredExtends?: DeferredExtend[];
  /** The project root, which `db.uiSchemaFile` is read from. */
  projectRoot: string;
  /**
   * The Schema Builder's definition to generate from, when the caller holds it
   * already: a Builder save generates from the definition it is writing, the
   * same one the file then holds. Absent, it is read from `db.uiSchemaFile`.
   */
  manifest?: UiSchemaManifest;
  /**
   * Entities the database already holds that no snapshot records, each with
   * its kind: a Schema Builder save adopting a table an earlier version made.
   * Their addresses and sibling fields were there before those rules, so the
   * checks judge them as recorded, as a database's own check judges a table it
   * holds. `migrate:create` reads no database and passes none.
   */
  held?: readonly HeldEntity[];
  /**
   * The one entity a save writes its migration for, by kind and slug: the
   * address check judges it alone as new, against every other entity's
   * address, and the sibling-field check judges its fields alone, since the
   * migration changes nothing else. Absent, every entity is judged, as
   * `migrate:create` judges them.
   */
  judged?: JudgedEntity;
  /** Absolute path to the migrations folder. */
  migrationsDir: string;
  dialect: SupportedDialect;
  /** Where each warning goes, and the lines a refusal names before it is thrown. */
  logger: { warn(message: string): void; error(message: string): void };
  /**
   * The naming the site's field-group storage is on (`field-group-storage-names`): the table each
   * field group is generated under, and the registry its Builder row is upserted into. A Builder
   * save reads it from the database it writes to. Absent, the latest snapshot's naming (legacy where the
   * folder has none), so every offline command follows the history.
   */
  fieldGroupNaming?: FieldGroupNaming;
  /**
   * The table each field group's registry row names, by slug, where the caller read the registry
   * (`field-group-stored-tables`): a group the registry holds is generated under the table it is
   * stored in, whatever naming it was created under, and only a group it does not hold takes its
   * name from `fieldGroupNaming`.
   */
  fieldGroupTables?: ReadonlyMap<string, string>;
}

/** The inputs `generateMigration` takes, as `appMigrationInputs` prepares them. */
export interface AppMigrationInputs {
  collections: MinimalConfigEntity[];
  singles: MinimalConfigEntity[];
  components: MinimalConfigEntity[];
  metadataUpserts: { tableName: string; sql: string }[];
  previousMetadataUpserts: { tableName: string; sql: string }[];
  appStream: AppStreamTables;
  /** The latest snapshot file, or null where the folder has none. */
  latest: { data: SnapshotFile } | null;
  /**
   * The field-group names `components` were resolved under: the caller's, else the latest
   * snapshot's. Passed on to `generateMigration`, which records it and refuses one that differs
   * from the history's.
   */
  fieldGroupNaming: FieldGroupNaming;
  /** Whether there is nothing a migration could be generated from (`nothingToGenerate`). */
  nothing: boolean;
}

/**
 * The inputs an app migration is generated from, read and checked. A
 * declaration a migration cannot carry is refused here, before anything is
 * written.
 */
export async function appMigrationInputs(
  input: AppMigrationInputsArgs
): Promise<AppMigrationInputs> {
  const { config, dialect, logger } = input;
  // The Builder's definitions, read and judged as `migrate:check` reads them
  // (`readBuilderDefinitions`), merged with the configuration's entities.
  // Each Builder entity carries its manifest entry as its settings, as each
  // code-first one carries its config entry, so the snapshot records both; the
  // merge sets them (`uiToMinimal`).
  //
  // A migration is the one artifact that outlives the process that wrote it, so
  // a declaration its own field type rejects would become a deployment that
  // materializes the schema and then cannot boot on it: the configuration's
  // declarations are checked here, the definition's by the reader.
  assertPluginFieldDeclarations({
    collections: config.collections,
    singles: config.singles,
    fieldGroups: config.fieldGroups,
  });
  const definitions = await readBuilderDefinitions({
    config,
    ...(input.deferredExtends === undefined
      ? {}
      : { deferredExtends: input.deferredExtends }),
    projectRoot: input.projectRoot,
    ...(input.manifest === undefined ? {} : { manifest: input.manifest }),
    logger,
  });
  const latest = await loadLatestSnapshot(resolve(input.migrationsDir, "meta"));
  // The names the history keeps field groups under, unless the caller read the site's own: a
  // history moved to the current names generates every group there, and `generateMigration`
  // refuses a caller's naming that differs from the history's (`refuseNamingAgainstHistory`).
  const fieldGroupNaming =
    input.fieldGroupNaming ??
    (latest === null ? "legacy" : snapshotFieldGroupNaming(latest.data));
  // Each field group under the table it is stored in on this site (`withFieldGroupTables`).
  const fieldGroupNames = storageNamesFor(fieldGroupNaming);
  const merged = withFieldGroupTables(
    definitions.merged,
    fieldGroupNames,
    input.fieldGroupTables
  );
  const { collections, singles, components } = merged;

  // §4.12.7: per-dialect metadata-row upserts for UI-built entities that
  // survived the merge (code-first wins, per kind, so an unshadowed Single
  // whose slug a shadowed collection shares keeps its row).
  const metadataUpserts = builderMetadataUpserts(
    definitions.surviving,
    dialect,
    fieldGroupNames,
    input.fieldGroupTables
  );

  // The APP stream's extension schema, compiled the way boot compiles it:
  // tables the app declares through `db.schema.extend`, and elements it
  // contributes to a plugin's table. Plugins are compiled alongside because an
  // app hook may extend a plugin's table and would not resolve without them.
  //
  // Computed BEFORE the empty-entities check, because an app can have nothing
  // but extension schema. Taking that early return first meant an
  // extension-only configuration wrote no migration at all and production
  // never received the table.
  // The definitions judged against the latest snapshot, as `migrate:check` judges
  // them: a Builder entity the file lost (the drop below would take its
  // table), then each relationship's target. A save writing one entity's
  // migration judges that entity's relationships alone, and no loss
  // (`judgeBuilderDefinitions`).
  judgeBuilderDefinitions({
    definitions,
    recorded: latest?.data.entities,
    ...(input.judged === undefined ? {} : { judged: input.judged }),
  });

  // Before the app stream compiles: a plugin hook still extending a removed
  // collection's, Single's or field group's table would stop that compile with
  // a bare "does not exist", where this names what the hook adds. A drop of an
  // entity something still depends on is refused with the message a delete
  // gets. The check and its readers are loaded only when the migration would
  // drop one, which most runs do not.
  const removed = removedEntityTables({
    previous: latest?.data.snapshot ?? EMPTY_SNAPSHOT,
    collections,
    singles,
    components,
    dialect,
  });
  if (
    removed.collections.length > 0 ||
    removed.singles.length > 0 ||
    removed.fieldGroups.length > 0
  ) {
    const [{ assertRemovedEntitiesUnused }, { compileExtensionSchemaWith }] =
      await Promise.all([
        import("./removed-collections"),
        import("../../collections/services/collection-dependents-schema"),
      ]);
    await assertRemovedEntitiesUnused({
      removed,
      collections,
      singles,
      components,
      dialect,
      extensionSchema: removed =>
        compileExtensionSchemaWith({
          config: config,
          dialect,
          removedCollections: removed,
          logger: { warn: m => logger.warn(m) },
        }),
    });
  }

  const appStream = await compileAppStreamTables({
    config: config,
    dialect,
    logger: { warn: m => logger.warn(m) },
    // Each field group under the table the entities above name, so a contribution to it attaches
    // to the same physical table in both streams. Only where the caller said where groups are
    // stored; otherwise both streams derive the same names, as before.
    ...(fieldGroupNaming === "legacy" &&
    input.fieldGroupTables === undefined
      ? {}
      : {
          fieldGroupTables: new Map(
            components.map(component => [component.slug, component.tableName])
          ),
        }),
  });

  // A new address is judged by the one address rule before anything is written.
  // A scoped save judges its own collection against every address the project
  // uses, the configuration's entities no snapshot records yet included: the
  // next full migration or start judges them all, and would refuse a pair the
  // save let through.
  const judgedAgainst = withHeld(latest, input.held ?? []);
  assertMigrationAddresses(merged, judgedAgainst, logger, input.judged);
  const judgedEntities = onlyJudged(merged, input.judged);
  // And each new pair of sibling fields, against the fields the latest snapshot records.
  assertMigrationSiblingFields(judgedEntities, judgedAgainst, logger);
  // The rows as the previous snapshot recorded each Builder entity, for a
  // migration that writes a row for its settings alone to write back on the
  // way down. A snapshot with no settings record has none to offer.
  const previousMetadataUpserts = builderMetadataUpserts(
    builderEntriesOf(latest?.data.entities),
    dialect,
    fieldGroupNames,
    input.fieldGroupTables
  );
  const nothing = nothingToGenerate({
    entityCount: collections.length + singles.length + components.length,
    appStream,
    recordedTableCount: latest?.data.snapshot.tables.length ?? 0,
  });

  return {
    collections,
    singles,
    components,
    metadataUpserts,
    previousMetadataUpserts,
    appStream,
    latest,
    fieldGroupNaming,
    nothing,
  };
}

/** An entity the database already holds that no snapshot records, and its kind. */
export interface HeldEntity {
  kind: JudgedEntity["kind"];
  entity: UiSchemaEntity;
}

/** Where a snapshot records each kind's settings. */
const RECORDED_UNDER = {
  collection: "collections",
  single: "singles",
  fieldGroup: "fieldGroups",
} as const;

/** `merged` narrowed to the judged entity, or whole without one. */
function onlyJudged<
  T extends {
    collections: { slug: string }[];
    singles: { slug: string }[];
    components: { slug: string }[];
  },
>(merged: T, judged: JudgedEntity | undefined): T {
  if (judged === undefined) return merged;
  const keep = (kind: JudgedEntity["kind"], list: { slug: string }[]) =>
    kind === judged.kind ? list.filter(e => e.slug === judged.slug) : [];
  return {
    ...merged,
    collections: keep("collection", merged.collections),
    singles: keep("single", merged.singles),
    components: keep("fieldGroup", merged.components),
  };
}

/**
 * `latest` with each held entity recorded as its definition, under its kind,
 * for the address and sibling-field checks alone: nothing is written from it.
 */
function withHeld(
  latest: { data: SnapshotFile } | null,
  held: readonly HeldEntity[]
): { data: SnapshotFile } | null {
  if (held.length === 0) return latest;
  const data: SnapshotFile = latest?.data ?? {
    version: 1,
    migrationHash: "",
    snapshot: EMPTY_SNAPSHOT,
  };
  const recorded = data.entities ?? {
    collections: {},
    singles: {},
    fieldGroups: {},
  };
  const entities = {
    collections: { ...recorded.collections },
    singles: { ...recorded.singles },
    fieldGroups: { ...recorded.fieldGroups },
  };
  for (const { kind, entity } of held) {
    entities[RECORDED_UNDER[kind]][entity.slug] ??= {
      source: "builder",
      settings: entity as unknown as SettingsObject,
    };
  }
  return {
    ...latest,
    data: { ...data, entities },
  };
}

/**
 * Whether the app stream has nothing it could possibly emit.
 *
 * Needs BOTH sides empty. A config that has just removed its last entity or
 * its last contribution still has something to emit — the drop — and only the
 * latest snapshot says so. Deciding on the config alone skipped exactly that
 * migration, while `migrate:check`, which compares against the snapshot, kept
 * reporting it as pending.
 */
export function nothingToGenerate(input: {
  entityCount: number;
  appStream: AppStreamTables;
  recordedTableCount: number;
}): boolean {
  return (
    input.entityCount === 0 &&
    !hasAppStreamTables(input.appStream) &&
    input.recordedTableCount === 0
  );
}

/**
 * The merged entities with each field group's table as it is stored: the table its registry row
 * names where `stored` holds one, otherwise its derived name under `names`' prefix.
 *
 * Every field group's name is derived as the legacy prefix and the slug's table form, by its own
 * kind's rule (`resolveComponentTableName` for code-first, `uiToMinimal` for Builder groups), so
 * moving it to the current names swaps the prefix and keeps that form. The storage migration moves
 * a derived name the same way (`fg_` + the slug's form), so a site that migrated holds exactly
 * these names, except for a row an earlier release created under the other naming, which `stored`
 * names.
 */
export function withFieldGroupTables<T extends { components: MinimalConfigEntity[] }>(
  merged: T,
  names: FieldGroupStorageNames,
  stored: ReadonlyMap<string, string> | undefined
): T {
  if (
    names.naming === "legacy" &&
    (stored === undefined || stored.size === 0)
  ) {
    return merged;
  }
  return {
    ...merged,
    components: merged.components.map(component => ({
      ...component,
      tableName:
        stored?.get(component.slug) ??
        underNaming(names.naming, component.tableName),
    })),
  };
}

/**
 * The registry-row upserts for UI-built entities (spec §4.12.7), keyed by data
 * table. The caller hands in only the entries no code-first entity of the
 * same kind shadows.
 */
function builderMetadataUpserts(
  entries: {
    collections: readonly UiSchemaEntity[];
    singles: readonly UiSchemaEntity[];
    components: readonly UiSchemaEntity[];
  },
  dialect: SupportedDialect,
  /** The field-group registry each Builder group's row goes to, and the prefix its table carries. */
  fieldGroupNames: FieldGroupStorageNames,
  /** The table each group's registry row already names, by slug (`withFieldGroupTables`). */
  storedTables: ReadonlyMap<string, string> | undefined
): { tableName: string; sql: string }[] {
  const tn = (slug: string, prefix: string) =>
    `${prefix}${slug.replace(/-/g, "_")}`;
  const upserts: { tableName: string; sql: string }[] = [];
  for (const c of entries.collections) {
    upserts.push({
      tableName: tn(c.slug, "dc_"),
      sql: buildCollectionMetadataUpsert(c, dialect),
    });
  }
  for (const s of entries.singles) {
    upserts.push({
      tableName: tn(s.slug, "single_"),
      sql: buildSingleMetadataUpsert(s, dialect),
    });
  }
  for (const cp of entries.components) {
    upserts.push({
      tableName:
        storedTables?.get(cp.slug) ?? tn(cp.slug, fieldGroupNames.tablePrefix),
      sql: buildComponentMetadataUpsert(
        cp,
        dialect,
        fieldGroupNames.registryTable,
        storedTables?.get(cp.slug)
      ),
    });
  }
  return upserts;
}

/**
 * The Builder entities a snapshot's settings record holds, as the manifest
 * entries they were recorded from: the record is the manifest entry with only
 * functions left out, and a manifest holds none.
 */
function builderEntriesOf(record: EntitySettingsRecord | undefined): {
  collections: UiSchemaEntity[];
  singles: UiSchemaEntity[];
  components: UiSchemaEntity[];
} {
  const of = (byslug: EntitySettingsRecord["collections"] | undefined) =>
    Object.values(byslug ?? {})
      .filter(entry => entry.source === "builder")
      .map(entry => entry.settings as unknown as UiSchemaEntity);
  return {
    collections: of(record?.collections),
    singles: of(record?.singles),
    components: of(record?.fieldGroups),
  };
}
