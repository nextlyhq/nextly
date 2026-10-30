// Read what `nextly repair-columns` compares: the configuration with the Builder manifest, the
// registry rows, the newest applied migration snapshot that records entities, and the stored user
// field definitions. Every read is a read; nothing here writes to the database, the manifest or
// the migrations folder.
//
// A record it cannot read is a reason to stop, not to fall back: judging columns against an older
// definition than the one last applied would report a correct column as wrong.
//
// CLI only. The registry services resolve their tables by name, so the caller installs the
// registry resolver first, as every CLI run that reads the registry does.
//
// @module domains/schema/repair-columns/read-entities

import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { UserFieldDefinitionRecord } from "../../../schemas/user-field-definitions/types";
import type { Logger } from "../../../shared/types";
import { CollectionRegistryService } from "../../collections/services/collection-registry-service";
import { MIGRATION_TARGET } from "../../field-groups/migration/target";
import { FieldGroupRegistryService } from "../../field-groups/services/field-group-registry-service";
import { SingleRegistryService } from "../../singles/services/single-registry-service";
import { UserExtSchemaService } from "../../users/services/user-ext-schema-service";
import { UserFieldDefinitionService } from "../../users/services/user-field-definition-service";
import { appliedFilenames } from "../events/newest-event";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import {
  DEFAULT_TABLE_NAME_RESOLVERS,
  resolveDeclaredSchema,
} from "../migrate/resolved-schema";
import { loadSnapshots, type LoadedSnapshot } from "../migrate/snapshot-source";
import {
  isEntitySettingsRecord,
  type EntitySettingsRecord,
  type RecordedEntitySettings,
} from "../migrate-create/entity-settings";
import { loadUiSchema } from "../ui-schema/loader";

import {
  resolveRepairEntities,
  type ConfiguredEntity,
  type RegistryEntity,
  type SnapshotEntity,
  type UserFieldSources,
} from "./resolve-entities";
import type { RepairEntity } from "./types";

type RecordedKind = ConfiguredEntity["kind"];

/** The parts of a loaded configuration the comparison reads. */
export interface RepairColumnsConfig {
  collections: readonly unknown[];
  singles?: readonly unknown[];
  fieldGroups?: readonly unknown[];
  plugins?: readonly unknown[];
  /** The code user fields, which the next sync stores beside the admin's. */
  users?: { fields?: readonly unknown[] };
  /** Where the Builder manifest is, relative to the project. */
  db: { uiSchemaFile: string };
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

/** One entity of one kind, as a key: the same slug may name a collection, a Single and a group. */
const entityKey = (kind: RecordedKind, slug: string) => `${kind}\u0000${slug}`;

/** Where a plugin's `contributes` lists each kind of entity it owns. */
const CONTRIBUTED_LISTS: Record<
  RecordedKind,
  "collections" | "singles" | "fieldGroups"
> = {
  collection: "collections",
  single: "singles",
  fieldGroup: "fieldGroups",
};

/** As much of a plugin's declaration as says which entities it owns. */
interface PluginDeclaration {
  name?: unknown;
  /** Collections an older plugin declares outside `contributes`. */
  collections?: unknown;
  contributes?: Partial<
    Record<(typeof CONTRIBUTED_LISTS)[RecordedKind], unknown>
  > | null;
}

/** The slugs a declared entity list names, ignoring anything that is not an entity with one. */
function slugsOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry: unknown) => {
    const slug = (entry as { slug?: unknown } | null)?.slug;
    return typeof slug === "string" ? [slug] : [];
  });
}

/**
 * The plugin that contributed each entity, by kind and slug, as the configuration's plugins declare
 * it: each kind from its own `contributes` list, and collections also from the top-level list older
 * plugins use. A plugin that declares nothing owns nothing.
 */
function pluginOwners(plugins: readonly unknown[] | undefined) {
  const owners = new Map<string, string>();
  for (const plugin of plugins ?? []) {
    const { name, collections, contributes } = (plugin ??
      {}) as PluginDeclaration;
    if (typeof name !== "string") continue;
    const claim = (kind: RecordedKind, list: unknown) => {
      for (const slug of slugsOf(list)) owners.set(entityKey(kind, slug), name);
    };
    for (const kind of Object.keys(CONTRIBUTED_LISTS) as RecordedKind[]) {
      claim(kind, contributes?.[CONTRIBUTED_LISTS[kind]]);
    }
    claim("collection", collections);
  }
  return owners;
}

/** The configuration's code-first entities, each with its table resolved. */
function codeFirstEntities(
  config: RepairColumnsConfig,
  ownerOf: (kind: RecordedKind, slug: string) => string | undefined
): ConfiguredEntity[] {
  const of = (kind: RecordedKind, list: readonly unknown[] | undefined) =>
    (list ?? []).map((raw): ConfiguredEntity => {
      const entity = raw as RawEntity;
      const plugin = ownerOf(kind, entity.slug);
      return {
        kind,
        slug: entity.slug,
        table: tableFor[kind](entity),
        fields: entity.fields ?? [],
        localized: entity.localized === true,
        origin: "codeFirst",
        ...(plugin !== undefined ? { plugin } : {}),
      };
    });
  return [
    ...of("collection", config.collections),
    ...of("single", config.singles),
    ...of("fieldGroup", config.fieldGroups),
  ];
}

/** Where the manifest lists each kind of entity. */
const MANIFEST_LISTS = {
  collection: "collections",
  single: "singles",
  fieldGroup: "components",
} as const satisfies Record<RecordedKind, string>;

/**
 * The Builder entities the next migration would apply: the manifest's, with the plugins' deferred
 * extensions of them and without those code-first shadows, merged as migration generation merges
 * them. The resolved entities do not carry `localized`, so it is read from the manifest itself.
 *
 * An absent manifest is the ordinary code-first project and declares none; one that exists and
 * cannot be read stops the run, since dropping it would drop every Builder declaration.
 */
async function builderEntities(
  args: ConfigurationArgs,
  ownerOf: (kind: RecordedKind, slug: string) => string | undefined
): Promise<ConfiguredEntity[]> {
  const [declared, manifest] = await Promise.all([
    resolveDeclaredSchema({
      projectRoot: args.projectRoot,
      config: args.config,
      ...(args.deferredExtends !== undefined
        ? { deferredExtends: args.deferredExtends }
        : {}),
    }),
    loadUiSchema({
      projectRoot: args.projectRoot,
      uiSchemaFile: args.config.db.uiSchemaFile,
    }),
  ]);
  const localized = new Set(
    (Object.keys(MANIFEST_LISTS) as RecordedKind[]).flatMap(kind =>
      (manifest[MANIFEST_LISTS[kind]] ?? [])
        .filter(entity => entity.localized === true)
        .map(entity => entityKey(kind, entity.slug))
    )
  );
  return declared.entities
    .filter(entity => entity.builtBy !== "codeFirst")
    .map((entity): ConfiguredEntity => {
      const plugin = ownerOf(entity.kind, entity.slug);
      return {
        kind: entity.kind,
        slug: entity.slug,
        table: entity.tableName,
        fields: entity.fields,
        localized: localized.has(entityKey(entity.kind, entity.slug)),
        origin: entity.builtBy,
        ...(plugin !== undefined ? { plugin } : {}),
      };
    });
}

/** What the configured side is read from. */
interface ConfigurationArgs {
  config: RepairColumnsConfig;
  /** The project the configuration and its manifest are in. */
  projectRoot: string;
  /** Plugin additions to Builder entities, as `loadConfig` returns them. */
  deferredExtends?: readonly unknown[];
}

/** Every entity the next migration would apply: code-first, then the Builder's. */
async function configuredEntities(
  args: ConfigurationArgs
): Promise<ConfiguredEntity[]> {
  const owners = pluginOwners(args.config.plugins);
  const ownerOf = (kind: RecordedKind, slug: string) =>
    owners.get(entityKey(kind, slug));
  return [
    ...codeFirstEntities(args.config, ownerOf),
    ...(await builderEntities(args, ownerOf)),
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

/** The ledger filename of a snapshot's migration, as `loadSnapshots` asks the ledger about it. */
const ledgerFilenameOf = (snapshotFile: string) =>
  `${snapshotFile.replace(/\.snapshot\.json$/, "")}.sql`;

/** The error that stops a run whose newest applied definition cannot be read. */
function unreadableSnapshot(file: string, why: string): NextlyError {
  return NextlyError.configuration({
    logMessage: `The applied migration snapshot meta/${file} ${why}, so what the database last had applied cannot be known. Restore the file, then run \`nextly repair-columns\` again.`,
    logContext: { file },
  });
}

/**
 * Every snapshot file in the migrations folder, whether or not it can be read. A folder that does
 * not exist holds none; one that exists and cannot be listed stops the run, since the snapshots in
 * it may record what was applied.
 */
async function snapshotFiles(migrationsDir: string): Promise<string[]> {
  const metaDir = resolve(migrationsDir, "meta");
  try {
    const files = await readdir(metaDir);
    return files.filter(file => file.endsWith(".snapshot.json")).sort();
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return [];
    throw NextlyError.configuration({
      logMessage: `The migration snapshots in ${metaDir} could not be listed, so what the database last had applied cannot be known.`,
      logContext: { metaDir },
      ...(error instanceof Error ? { cause: error } : {}),
    });
  }
}

/**
 * Stop where a snapshot of an applied migration could not be read. `loadSnapshots` skips such a
 * file, and the next older record would then stand in for it. One whose migration has not been
 * applied says nothing about the database, so it may stay unreadable.
 */
function assertAppliedSnapshotsRead(
  listed: readonly string[],
  loaded: readonly LoadedSnapshot[],
  applied: ReadonlySet<string>
): void {
  const read = new Set(loaded.map(snapshot => snapshot.file));
  const unread = listed.find(
    file => !read.has(file) && applied.has(ledgerFilenameOf(file))
  );
  if (unread !== undefined) {
    throw unreadableSnapshot(unread, "could not be read or parsed");
  }
}

/**
 * The entity record of the newest applied snapshot that has one, or undefined where none does.
 *
 * A snapshot whose migration has not been applied is skipped, and so is one written before
 * snapshots recorded entities: its silence says nothing about what was applied. One that has an
 * entity record this version cannot read stops the run rather than be passed over for an older one.
 */
function newestAppliedRecord(
  loaded: readonly LoadedSnapshot[]
): EntitySettingsRecord | undefined {
  // Lexicographic order is migration order, so the newest is the last one that qualifies.
  for (const { file, snapshot, applied } of [...loaded].reverse()) {
    if (!applied) continue;
    const parsed: unknown = snapshot;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw unreadableSnapshot(file, "is not a snapshot");
    }
    if (!Object.hasOwn(parsed, "entities")) continue;
    const record = (parsed as { entities?: unknown }).entities;
    if (isEntitySettingsRecord(record)) return record;
    throw unreadableSnapshot(
      file,
      "records its entities in a shape that cannot be read"
    );
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
  const [listed, loaded] = await Promise.all([
    snapshotFiles(migrationsDir),
    loadSnapshots({
      migrationsDir,
      isApplied: file => Promise.resolve(applied.has(file)),
    }),
  ]);
  assertAppliedSnapshotsRead(listed, loaded, applied);
  const record = newestAppliedRecord(loaded);
  return record === undefined ? [] : recordedEntities(record);
}

/**
 * The user field definitions service, keeping the rows its merge read, so the comparison can tell
 * the admin's fields from the code fields without reading the definitions a second time.
 */
class RecordingDefinitionService extends UserFieldDefinitionService {
  records: readonly UserFieldDefinitionRecord[] = [];

  override async getMergedFields(): Promise<UserFieldDefinitionRecord[]> {
    const records = await super.getMergedFields();
    this.records = records;
    return records;
  }
}

/**
 * The user fields `user_ext` is built from, as stored and as the next sync would store them.
 *
 * Stored: the definitions as the user-extension builder merges them, or null with no definitions
 * table. Configured: the configuration's code fields, which the sync writes over the stored code
 * rows, then the stored fields the admin added, which the sync leaves alone.
 */
async function userFieldSources(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  logger: Logger,
  codeFields: readonly unknown[]
): Promise<UserFieldSources> {
  if (!(await adapter.tableExists("user_field_definitions"))) {
    return { stored: null, configured: codeFields };
  }
  const definitions = new RecordingDefinitionService(adapter, logger);
  const builder = new UserExtSchemaService(dialect, definitions, logger);
  await builder.loadMergedFields();
  const stored = builder.getMergedFieldConfigs();
  const adminNames = new Set(
    definitions.records
      .filter(record => record.source === "ui")
      .map(record => record.name)
  );
  const adminFields = stored.filter(
    field =>
      "name" in field &&
      typeof field.name === "string" &&
      adminNames.has(field.name)
  );
  return { stored, configured: [...codeFields, ...adminFields] };
}

/** Every entity the comparison covers, with the definitions each is judged against. */
export async function readRepairEntities(args: {
  adapter: DrizzleAdapter;
  dialect: SupportedDialect;
  config: RepairColumnsConfig;
  /** The project the configuration and its Builder manifest are in. */
  projectRoot: string;
  /** Plugin additions to Builder entities, as `loadConfig` returns them. */
  deferredExtends?: readonly unknown[];
  migrationsDir: string;
  logger: Logger;
}): Promise<RepairEntity[]> {
  const { adapter, dialect, logger } = args;
  // Independent reads, so none waits on another.
  const [configured, registry, snapshots, userFields] = await Promise.all([
    configuredEntities(args),
    registryEntities(adapter, logger),
    snapshotEntities(adapter, dialect, args.migrationsDir),
    userFieldSources(adapter, dialect, logger, args.config.users?.fields ?? []),
  ]);
  return resolveRepairEntities({
    configured,
    registry,
    snapshots,
    userFields,
  });
}
