// Read what `nextly repair-columns` compares: the configuration, the registry rows, the newest
// applied migration snapshot that records entities, and the stored user field definitions. Every
// read is a read; nothing here writes to the database or the migrations folder.
//
// CLI only. The registry services resolve their tables by name, so the caller installs the
// registry resolver first, as every CLI run that reads the registry does.
//
// @module domains/schema/repair-columns/read-entities

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { Logger } from "../../../shared/types";
import { CollectionRegistryService } from "../../collections/services/collection-registry-service";
import { MIGRATION_TARGET } from "../../field-groups/migration/target";
import { FieldGroupRegistryService } from "../../field-groups/services/field-group-registry-service";
import { SingleRegistryService } from "../../singles/services/single-registry-service";
import { UserExtSchemaService } from "../../users/services/user-ext-schema-service";
import { UserFieldDefinitionService } from "../../users/services/user-field-definition-service";
import { appliedFilenames } from "../events/newest-event";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import { DEFAULT_TABLE_NAME_RESOLVERS } from "../migrate/resolved-schema";
import { loadSnapshots, type LoadedSnapshot } from "../migrate/snapshot-source";
import {
  isEntitySettingsRecord,
  type EntitySettingsRecord,
  type RecordedEntitySettings,
} from "../migrate-create/entity-settings";

import {
  resolveRepairEntities,
  type ConfiguredEntity,
  type RegistryEntity,
  type SnapshotEntity,
} from "./resolve-entities";
import type { RepairEntity } from "./types";

type RecordedKind = ConfiguredEntity["kind"];

/** The parts of a loaded configuration the comparison reads. */
export interface RepairColumnsConfig {
  collections: readonly unknown[];
  singles?: readonly unknown[];
  fieldGroups?: readonly unknown[];
  plugins?: readonly unknown[];
}

interface RawEntity {
  slug: string;
  dbName?: string;
  fields?: readonly unknown[];
  localized?: boolean;
}

const tableFor: Record<RecordedKind, (e: RawEntity) => string> = {
  collection: e => DEFAULT_TABLE_NAME_RESOLVERS.collection(e),
  single: e => DEFAULT_TABLE_NAME_RESOLVERS.single(e),
  fieldGroup: e => DEFAULT_TABLE_NAME_RESOLVERS.component(e),
};

/** The plugin that contributed each collection slug, as the configuration's plugins declare it. */
function pluginBySlug(
  plugins: readonly unknown[] | undefined
): Map<string, string> {
  const owners = new Map<string, string>();
  for (const plugin of plugins ?? []) {
    const { name, contributes } = plugin as {
      name?: unknown;
      contributes?: { collections?: readonly { slug?: unknown }[] };
    };
    if (typeof name !== "string") continue;
    for (const contributed of contributes?.collections ?? []) {
      if (typeof contributed.slug === "string")
        owners.set(contributed.slug, name);
    }
  }
  return owners;
}

/** The configuration's code-first entities, each with its table resolved. */
function configuredEntities(config: RepairColumnsConfig): ConfiguredEntity[] {
  const plugins = pluginBySlug(config.plugins);
  const of = (kind: RecordedKind, list: readonly unknown[] | undefined) =>
    (list ?? []).map((raw): ConfiguredEntity => {
      const entity = raw as RawEntity;
      const plugin =
        kind === "collection" ? plugins.get(entity.slug) : undefined;
      return {
        kind,
        slug: entity.slug,
        table: tableFor[kind](entity),
        fields: entity.fields ?? [],
        localized: entity.localized === true,
        ...(plugin !== undefined ? { plugin } : {}),
      };
    });
  return [
    ...of("collection", config.collections),
    ...of("single", config.singles),
    ...of("fieldGroup", config.fieldGroups),
  ];
}

/**
 * The table each registry keeps its rows in. The field-group registry has had two names, and the
 * database holds it under one of them.
 */
const REGISTRY_TABLES: Record<RecordedKind, readonly string[]> = {
  collection: ["dynamic_collections"],
  single: ["dynamic_singles"],
  fieldGroup: [STORAGE_FORMAT.registryTable, MIGRATION_TARGET.registryTable],
};

/** How each registry's rows are read, through the service that owns that registry. */
const REGISTRY_READERS: Record<
  RecordedKind,
  (adapter: DrizzleAdapter, logger: Logger) => Promise<readonly unknown[]>
> = {
  collection: (adapter, logger) =>
    new CollectionRegistryService(adapter, logger).getAllCollections(),
  single: (adapter, logger) =>
    new SingleRegistryService(adapter, logger).getAllSingles(),
  fieldGroup: (adapter, logger) =>
    new FieldGroupRegistryService(adapter, logger).getAllComponents(),
};

/** Whether the database has the registry `kind` is read from, under any name it has had. */
async function hasRegistry(
  adapter: DrizzleAdapter,
  kind: RecordedKind
): Promise<boolean> {
  for (const table of REGISTRY_TABLES[kind]) {
    if (await adapter.tableExists(table)) return true;
  }
  return false;
}

/**
 * One registry's rows. A registry the database does not have has none: a database can hold one
 * registry and not another, such as one created before Singles had a registry.
 */
async function registryRows(
  adapter: DrizzleAdapter,
  logger: Logger,
  kind: RecordedKind
): Promise<RegistryEntity[]> {
  if (!(await hasRegistry(adapter, kind))) return [];
  const rows = await REGISTRY_READERS[kind](adapter, logger);
  return rows.flatMap(raw => {
    const row = raw as Omit<RegistryEntity, "kind">;
    return typeof row.slug === "string" ? [{ ...row, kind }] : [];
  });
}

/** Every registry's rows, collections first, then Singles, then field groups. */
async function registryEntities(
  adapter: DrizzleAdapter,
  logger: Logger
): Promise<RegistryEntity[]> {
  const kinds = Object.keys(REGISTRY_TABLES) as RecordedKind[];
  const rows = await Promise.all(
    kinds.map(kind => registryRows(adapter, logger, kind))
  );
  return rows.flat();
}

/** The key a snapshot's entity record keeps each kind of entity under. */
const SNAPSHOT_RECORD_KEYS: Record<RecordedKind, keyof EntitySettingsRecord> = {
  collection: "collections",
  single: "singles",
  fieldGroup: "fieldGroups",
};

/** One entity as a snapshot recorded it, with its table resolved from the recorded settings. */
function snapshotEntityOf(
  kind: RecordedKind,
  slug: string,
  entry: RecordedEntitySettings
): SnapshotEntity {
  // The declaration as the snapshot stored it; read only the keys the comparison needs.
  const settings: Record<string, unknown> = entry.settings;
  const dbName =
    typeof settings.dbName === "string" ? settings.dbName : undefined;
  return {
    kind,
    slug,
    source: entry.source,
    fields: Array.isArray(settings.fields) ? settings.fields : [],
    localized: settings.localized === true,
    table: tableFor[kind]({
      slug,
      ...(dbName !== undefined ? { dbName } : {}),
    }),
  };
}

/** Every entity one snapshot's entity record holds. */
function recordedEntities(record: EntitySettingsRecord): SnapshotEntity[] {
  return (Object.keys(SNAPSHOT_RECORD_KEYS) as RecordedKind[]).flatMap(kind =>
    Object.entries(record[SNAPSHOT_RECORD_KEYS[kind]]).map(([slug, entry]) =>
      snapshotEntityOf(kind, slug, entry)
    )
  );
}

/**
 * The entity record of the newest applied snapshot that has one, or undefined where none does.
 *
 * A snapshot whose migration has not been applied is skipped, and so is one written before
 * snapshots recorded entities: its silence says nothing about what was applied.
 */
function newestAppliedRecord(
  loaded: readonly LoadedSnapshot[]
): EntitySettingsRecord | undefined {
  // Lexicographic order is migration order, so the newest is the last one that qualifies.
  for (const { snapshot, applied } of [...loaded].reverse()) {
    if (!applied) continue;
    const record = (snapshot as { entities?: unknown }).entities;
    if (isEntitySettingsRecord(record)) return record;
  }
  return undefined;
}

/**
 * Each entity as the newest applied snapshot that records entities holds it.
 *
 * Every snapshot records every collection, Single and field group there was when it was written,
 * whole, so that one snapshot is the applied definition of all of them. An entity it does not
 * record had been removed by then, and an older snapshot's record of it is out of date, so it has
 * no snapshot record at all.
 */
async function snapshotEntities(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  migrationsDir: string
): Promise<SnapshotEntity[]> {
  // With no ledger nothing has been applied, so no snapshot speaks for the database.
  if (!(await adapter.tableExists("nextly_schema_events"))) return [];
  const events = new SchemaEventsRepository(adapter.getDrizzle(), dialect);
  // The ledger read once for every snapshot. A file is applied where its newest event is, which is
  // what `isFileApplied` asks of each file in turn.
  const applied = appliedFilenames(await events.listFileApplies());
  const loaded = await loadSnapshots({
    migrationsDir,
    isApplied: file => Promise.resolve(applied.has(file)),
  });
  const record = newestAppliedRecord(loaded);
  return record === undefined ? [] : recordedEntities(record);
}

/** The user fields the user-extension builder builds `user_ext` from, or null with no definitions. */
async function storedUserFields(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  logger: Logger
): Promise<readonly unknown[] | null> {
  if (!(await adapter.tableExists("user_field_definitions"))) return null;
  const builder = new UserExtSchemaService(
    dialect,
    new UserFieldDefinitionService(adapter, logger),
    logger
  );
  await builder.loadMergedFields();
  return builder.getMergedFieldConfigs();
}

/** Every entity the comparison covers, with the definition each is judged against. */
export async function readRepairEntities(args: {
  adapter: DrizzleAdapter;
  dialect: SupportedDialect;
  config: RepairColumnsConfig;
  migrationsDir: string;
  logger: Logger;
}): Promise<RepairEntity[]> {
  const { adapter, dialect, logger } = args;
  // Three independent reads, so none waits on another.
  const [registry, snapshots, userFields] = await Promise.all([
    registryEntities(adapter, logger),
    snapshotEntities(adapter, dialect, args.migrationsDir),
    storedUserFields(adapter, dialect, logger),
  ]);
  return resolveRepairEntities({
    configured: configuredEntities(args.config),
    registry,
    snapshots,
    userFields,
  });
}
