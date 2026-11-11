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
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { assertPluginFieldDeclarations } from "../../../shared/lib/assert-plugin-field-declarations";
import { resolveSingleTableName } from "../../singles/services/resolve-single-table-name";
import { loadUiSchema } from "../ui-schema/loader";
import {
  applyDeferredExtendsToManifest,
  mergeUiEntities,
} from "../ui-schema/merge";
import {
  buildCollectionMetadataUpsert,
  buildComponentMetadataUpsert,
  buildSingleMetadataUpsert,
} from "../ui-schema/metadata-sql";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../utils/resolve-table-name";

import { assertMigrationAddresses } from "./addresses";
import {
  compileAppStreamTables,
  hasAppStreamTables,
  type AppStreamTables,
} from "./app-stream";
import { toMinimalEntities } from "./config-entities";
import type { EntitySettingsRecord, SettingsObject } from "./entity-settings";
import { removedEntityTables, type MinimalConfigEntity } from "./generate";
import { assertMigrationSiblingFields } from "./sibling-fields";
import {
  EMPTY_SNAPSHOT,
  loadLatestSnapshot,
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
   * Collections the database already holds that no snapshot records: a
   * Schema Builder save adopting a table an earlier version made. Their
   * addresses and sibling fields were there before those rules, so the checks
   * judge them as recorded, as a database's own check judges a table it holds.
   * `migrate:create` reads no database and passes none.
   */
  held?: readonly UiSchemaEntity[];
  /**
   * The one collection a save writes its migration for: the address check
   * judges it alone as new, against every other entity's address, and the
   * sibling-field check judges its fields alone, since the migration changes
   * nothing else. Absent, every entity is judged, as `migrate:create` judges
   * them.
   */
  judged?: string;
  /** Absolute path to the migrations folder. */
  migrationsDir: string;
  dialect: SupportedDialect;
  /** Where each warning goes, and the lines a refusal names before it is thrown. */
  logger: { warn(message: string): void; error(message: string): void };
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
  // Convert config entries to the minimal shape the orchestrator needs. Each
  // kind resolves its table name through the same helper the runtime uses, so
  // generated names match the live database (collections, singles, and
  // components each normalize differently).
  const codeCollections = toMinimalEntities(config.collections, e =>
    resolveCollectionTableName(e.slug, e.dbName)
  );
  const codeSingles = toMinimalEntities(config.singles ?? [], e =>
    resolveSingleTableName({ slug: e.slug, dbName: e.dbName })
  );
  const codeComponents = toMinimalEntities(config.fieldGroups ?? [], e =>
    resolveComponentTableName(e.slug)
  );

  // Load + merge UI-built entities (code-first wins on slug collision).
  let manifest =
    input.manifest ??
    (await loadUiSchema({
      projectRoot: input.projectRoot,
      uiSchemaFile: config.db.uiSchemaFile,
    }));

  // Materialize plugin extends that target Builder-made entities (P8): append
  // the deferred extend fields onto the matching ui-schema entity so they land
  // in BOTH the table diff (below) and the dynamic_collections.fields metadata.
  manifest = applyDeferredExtendsToManifest(
    manifest,
    input.deferredExtends ?? []
  );

  const merged = mergeUiEntities({
    codeCollections,
    codeSingles,
    codeComponents,
    manifest,
  });
  for (const slug of merged.droppedUiSlugs) {
    logger.warn(
      `ui-schema.json entry '${slug}' is shadowed by a code-first collection of the same slug; the code definition wins.`
    );
  }
  // Each Builder entity carries its manifest entry as its settings, as each
  // code-first one carries its config entry, so the snapshot records both;
  // the merge sets them (`uiToMinimal`).
  const { collections, singles, components } = merged;

  // Checked on the config's and the manifest's own entries rather than the
  // merged ones: the merge has already dropped shadowed Builder entities by
  // slug, and those are filtered per kind below instead.
  //
  // A migration is the one artifact that outlives the process that wrote it, so
  // a declaration its own field type rejects would become a deployment that
  // materializes the schema and then cannot boot on it.
  //
  // A Builder entity shadowed by a code-first one of the same slug contributes
  // nothing to this migration, so it is skipped rather than failed on — a
  // cleanup that changes no DDL is not worth blocking on.
  // Shadowing is per KIND: the manifest allows the same slug on a collection, a
  // single and a field group, and the merge resolves each kind separately. A
  // single set of dropped slugs would filter out an unshadowed single named
  // `home` because a collection of that name was shadowed, and it would then
  // reach the migration unchecked.
  const survivingOf = <T extends { slug: string }>(
    list: readonly T[],
    codeFirst: ReadonlyArray<{ slug: string }>
  ): T[] => {
    const shadowed = new Set(codeFirst.map(e => e.slug));
    return list.filter(e => !shadowed.has(e.slug));
  };

  assertPluginFieldDeclarations({
    collections: config.collections,
    singles: config.singles,
    fieldGroups: config.fieldGroups,
  });
  assertPluginFieldDeclarations({
    collections: survivingOf(manifest.collections, config.collections),
    singles: survivingOf(manifest.singles, config.singles ?? []),
    fieldGroups: survivingOf(manifest.components, config.fieldGroups ?? []),
  });

  // §4.12.7: per-dialect metadata-row upserts for UI-built entities that
  // survived the merge (code-first wins → shadowed UI slugs are skipped).
  // Shadowing is per kind, as above: `merged.droppedUiSlugs` is one list for
  // every kind, and filtering by it would leave out the row of an unshadowed
  // Single whose slug a shadowed collection shares.
  const metadataUpserts = builderMetadataUpserts(
    {
      collections: survivingOf(manifest.collections, config.collections),
      singles: survivingOf(manifest.singles, config.singles ?? []),
      components: survivingOf(manifest.components, config.fieldGroups ?? []),
    },
    dialect
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
  const latest = await loadLatestSnapshot(resolve(input.migrationsDir, "meta"));

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
    dialect
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
    nothing,
  };
}

/** `merged` narrowed to the judged collection, or whole without one. */
function onlyJudged<T extends { collections: { slug: string }[] }>(
  merged: T,
  judged: string | undefined
): T {
  if (judged === undefined) return merged;
  return {
    ...merged,
    collections: merged.collections.filter(c => c.slug === judged),
    singles: [],
    components: [],
  };
}

/**
 * `latest` with each held collection recorded as its definition, for the
 * address and sibling-field checks alone: nothing is written from it.
 */
function withHeld(
  latest: { data: SnapshotFile } | null,
  held: readonly UiSchemaEntity[]
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
  const collections = { ...recorded.collections };
  for (const entity of held) {
    collections[entity.slug] ??= {
      source: "builder",
      settings: entity as unknown as SettingsObject,
    };
  }
  return {
    ...latest,
    data: { ...data, entities: { ...recorded, collections } },
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
  dialect: SupportedDialect
): { tableName: string; sql: string }[] {
  const tn = (
    slug: string,
    prefix: "dc_" | "single_" | typeof STORAGE_FORMAT.tablePrefix
  ) => `${prefix}${slug.replace(/-/g, "_")}`;
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
      tableName: tn(cp.slug, STORAGE_FORMAT.tablePrefix),
      sql: buildComponentMetadataUpsert(cp, dialect),
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
