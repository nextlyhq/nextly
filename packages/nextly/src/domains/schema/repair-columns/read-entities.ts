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

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  readableMigrationFiles,
  type DeclaredNames,
} from "../../../cli/utils/migration-discovery";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { UserFieldDefinitionRecord } from "../../../schemas/user-field-definitions/types";
import type { Logger } from "../../../shared/types";
import { CollectionRegistryService } from "../../collections/services/collection-registry-service";
import { MIGRATION_TARGET } from "../../field-groups/migration/target";
import { FieldGroupRegistryService } from "../../field-groups/services/field-group-registry-service";
import { recordedFieldGroupTable } from "../../field-groups/services/field-group-storage-names";
import { LOCALIZATION_MIGRATION_MARKER } from "../../i18n/migration/write-migration-file";
import { SingleRegistryService } from "../../singles/services/single-registry-service";
import { UserExtSchemaService } from "../../users/services/user-ext-schema-service";
import { UserFieldDefinitionService } from "../../users/services/user-field-definition-service";
import { ledgerFilename } from "../events/ledger-scope";
import { removedOnPurpose } from "../events/migration-state";
import {
  SchemaEventsRepository,
  type SchemaEventRow,
} from "../events/schema-events-repository";
import { blankMigrationNames } from "../migrate/history-line";
import { compareMigrationRecency } from "../migrate/migration-order";
import { readOldBuilderLedger } from "../migrate/old-builder-ledger";
import {
  DEFAULT_TABLE_NAME_RESOLVERS,
  resolveDeclaredSchema,
} from "../migrate/resolved-schema";
import {
  ledgerNameOfSnapshot,
  loadSnapshots,
  type LoadedSnapshot,
} from "../migrate/snapshot-source";
import {
  isEntitySettingsRecord,
  type EntitySettingsRecord,
  type RecordedEntitySettings,
} from "../migrate-create/entity-settings";
import { recordedSnapshotNames } from "../migrate-create/snapshot-io";
import { isCodeOwned } from "../pipeline/registered-collections";
import { appliedAppMigrations } from "../schema-version";
import { readUiSchema } from "../ui-schema/loader";

import {
  resolveRepairEntities,
  type ConfiguredEntity,
  type RegistryEntity,
  type RepairOverrides,
  type SnapshotEntity,
  type UserFieldSources,
} from "./resolve-entities";
import {
  appliedMigrationFileMissingError,
  appliedSnapshotInvalidError,
  appliedSnapshotsMissingError,
  rowsDivergedError,
  rowsWithoutTableError,
  snapshotFileUnreadableError,
  snapshotFolderUnreadableError,
  snapshotReadFailedOnceError,
  type StoppingRow,
} from "./stop-errors";
import type { TableWaits } from "./table-wait";
import type { RepairEntity } from "./types";

/** What the entity reads wait for, as a lock's facts would name it. */
const REGISTRY_READ = "nextly_schema_events";

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

/** The configured side: its entities, whether a manifest is checked out, and the names declared. */
interface Configuration {
  entities: ConfiguredEntity[];
  hasManifest: boolean;
  declared: DeclaredNames;
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
 *
 * Also whether a manifest is checked out, which the loader's empty manifest for an absent file
 * cannot say: an empty manifest removes every Builder entity the registry holds, while no manifest
 * at all leaves the registry rows to say what each would be. The file is read once, and the
 * entities, their `localized` and its presence all come from that read, so a file written while
 * the run starts cannot make them disagree.
 */
async function builderEntities(
  args: ConfigurationArgs,
  ownerOf: (kind: RecordedKind, slug: string) => string | undefined
): Promise<Configuration> {
  const { manifest, exists } = await readUiSchema({
    projectRoot: args.projectRoot,
    uiSchemaFile: args.config.db.uiSchemaFile,
  });
  const declared = await resolveDeclaredSchema({
    projectRoot: args.projectRoot,
    config: args.config,
    manifest,
    ...(args.deferredExtends !== undefined
      ? { deferredExtends: args.deferredExtends }
      : {}),
  });
  const localized = new Set(
    (Object.keys(MANIFEST_LISTS) as RecordedKind[]).flatMap(kind =>
      (manifest[MANIFEST_LISTS[kind]] ?? [])
        .filter(entity => entity.localized === true)
        .map(entity => entityKey(kind, entity.slug))
    )
  );
  const entities = declared.entities
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
  return {
    entities,
    hasManifest: exists,
    declared: {
      junctions: declared.junctionsByEntity,
      tables: declared.declaredTables,
    },
  };
}

/** What the configured side is read from. */
interface ConfigurationArgs {
  config: RepairColumnsConfig;
  /** The project the configuration and its manifest are in. */
  projectRoot: string;
  /** Plugin additions to Builder entities, as `loadConfig` returns them. */
  deferredExtends?: readonly unknown[];
}

/**
 * Every entity the next migration would apply, code-first then the Builder's, and whether a
 * Builder manifest is checked out to declare the Builder's.
 */
async function configuredEntities(
  args: ConfigurationArgs
): Promise<Configuration> {
  const owners = pluginOwners(args.config.plugins);
  const ownerOf = (kind: RecordedKind, slug: string) =>
    owners.get(entityKey(kind, slug));
  const builder = await builderEntities(args, ownerOf);
  return {
    ...builder,
    entities: [...codeFirstEntities(args.config, ownerOf), ...builder.entities],
  };
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

/** The registry status of an entity whose tables were changed while its row was not. */
const DIVERGED_STATUS = "diverged";

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

/** The table the database keeps `kind`'s registry in, or undefined where it has none. */
async function registryTableOf(
  adapter: DrizzleAdapter,
  kind: RecordedKind
): Promise<string | undefined> {
  for (const table of REGISTRY_TABLES[kind]) {
    if (await adapter.tableExists(table)) return table;
  }
  return undefined;
}

/** One registry's rows: those the comparison reads, and those it cannot go on past. */
interface RegistryReading {
  entities: RegistryEntity[];
  withoutTable: StoppingRow[];
  diverged: StoppingRow[];
}

/** A row as its service returns it; its slug and table are checked before either is trusted. */
type RawRow = Omit<RegistryEntity, "kind" | "slug" | "tableName"> & {
  slug?: unknown;
  tableName?: unknown;
};

/**
 * One registry's rows. A registry the database does not have has none: a database can hold one
 * registry and not another, such as one created before Singles had a registry.
 *
 * A row that names no table stops the run: where its columns are cannot be known, and leaving the
 * row out would report its entity as never applied, or not report it at all.
 *
 * So does a row marked as diverged, whatever else records its entity: its tables were changed and
 * its stored definition was not, so neither the row nor an older snapshot says what the database
 * holds. Reading it as never applied would send the owner to repeat the change the state forbids,
 * and judging its columns against an older record would convert them back.
 */
async function registryRows(
  adapter: DrizzleAdapter,
  logger: Logger,
  kind: RecordedKind
): Promise<RegistryReading> {
  const reading: RegistryReading = {
    entities: [],
    withoutTable: [],
    diverged: [],
  };
  const registryTable = await registryTableOf(adapter, kind);
  if (registryTable === undefined) return reading;
  const rows = await REGISTRY_READERS[kind](adapter, logger);
  for (const raw of rows) {
    const row = raw as RawRow;
    const { slug, tableName } = row;
    if (typeof slug !== "string") continue;
    const stopping = {
      kind,
      slug,
      registryTable,
      codeOwned: isCodeOwned({ locked: row.locked, source: row.source }),
    };
    if (typeof tableName !== "string" || tableName === "") {
      reading.withoutTable.push(stopping);
    } else if (row.migrationStatus === DIVERGED_STATUS) {
      reading.diverged.push(stopping);
    } else {
      reading.entities.push({ ...row, kind, slug, tableName });
    }
  }
  return reading;
}

/**
 * Every registry's rows, collections first, then Singles, then field groups.
 *
 * A row the run cannot go on past stops it, naming every such row of the one cause, so its owner
 * settles them together; a row with no table comes first.
 */
async function registryEntities(
  adapter: DrizzleAdapter,
  logger: Logger
): Promise<RegistryEntity[]> {
  const kinds = Object.keys(REGISTRY_TABLES) as RecordedKind[];
  const readings = await Promise.all(
    kinds.map(kind => registryRows(adapter, logger, kind))
  );
  const withoutTable = readings.flatMap(reading => reading.withoutTable);
  if (withoutTable.length > 0) throw rowsWithoutTableError(withoutTable);
  const diverged = readings.flatMap(reading => reading.diverged);
  if (diverged.length > 0) throw rowsDivergedError(diverged);
  return readings.flatMap(reading => reading.entities);
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
  entry: RecordedEntitySettings,
  tables: ReadonlyMap<string, Readonly<Record<string, string>>>
): SnapshotEntity {
  // The declaration as the snapshot stored it; read only the keys the comparison needs.
  const settings: Record<string, unknown> = entry.settings;
  const dbName =
    typeof settings.dbName === "string" ? settings.dbName : undefined;
  const table =
    kind === "fieldGroup"
      ? recordedFieldGroupTable(slug, name => tables.has(name))
      : tableFor[kind]({
          slug,
          ...(dbName !== undefined ? { dbName } : {}),
        });
  const columnTypes = tables.get(table);
  return {
    kind,
    slug,
    source: entry.source,
    fields: Array.isArray(settings.fields) ? settings.fields : [],
    localized: settings.localized === true,
    table,
    ...(columnTypes !== undefined ? { columnTypes } : {}),
  };
}

/** Every entity one snapshot's entity record holds. */
function recordedEntities(
  record: EntitySettingsRecord,
  tables: ReadonlyMap<string, Readonly<Record<string, string>>>
): SnapshotEntity[] {
  return (Object.keys(SNAPSHOT_RECORD_KEYS) as RecordedKind[]).flatMap(kind =>
    Object.entries(record[SNAPSHOT_RECORD_KEYS[kind]]).map(([slug, entry]) =>
      snapshotEntityOf(kind, slug, entry, tables)
    )
  );
}

/** Each recorded column's type, by its name; one in a shape this version cannot read is left out. */
function typesByColumn(columns: readonly unknown[]): Record<string, string> {
  const types: Record<string, string> = {};
  for (const column of columns) {
    const { name, type } = (column ?? {}) as { name?: unknown; type?: unknown };
    if (typeof name === "string" && typeof type === "string") {
      types[name] = type;
    }
  }
  return types;
}

/**
 * Each table a snapshot records, with the type of each of its columns: what its migration applied,
 * which the app's overrides are read from. A table or column in a shape this version cannot read
 * is left out, so it reads as recording no override rather than stopping the run.
 */
function recordedColumnTypes(
  file: object
): Map<string, Readonly<Record<string, string>>> {
  const out = new Map<string, Readonly<Record<string, string>>>();
  // A snapshot file holds the schema under `snapshot`, beside its entity record.
  const schema = (file as { snapshot?: unknown }).snapshot;
  const tables =
    typeof schema === "object" && schema !== null
      ? (schema as { tables?: unknown }).tables
      : undefined;
  if (!Array.isArray(tables)) return out;
  for (const table of tables as unknown[]) {
    const { name, columns } = (table ?? {}) as {
      name?: unknown;
      columns?: unknown;
    };
    if (typeof name !== "string" || !Array.isArray(columns)) continue;
    out.set(name, typesByColumn(columns as unknown[]));
  }
  return out;
}

/**
 * Every snapshot file in the migrations folder, whether or not it can be read. A folder that does
 * not exist holds none; one that exists and cannot be listed stops the run, since the snapshots in
 * it may record what was applied.
 */
async function snapshotFiles(metaDir: string): Promise<string[]> {
  try {
    const files = await readdir(metaDir);
    return files.filter(file => file.endsWith(".snapshot.json")).sort();
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return [];
    throw snapshotFolderUnreadableError(metaDir, error);
  }
}

/**
 * The snapshots whose migration file is beside the folder, the only ones any reader loads. It lists
 * the migrations folder too, so the refusal names whichever of the two cannot be.
 */
async function snapshotsWithMigration(metaDir: string): Promise<string[]> {
  try {
    return await recordedSnapshotNames(metaDir);
  } catch (error) {
    const { path } = error as { path?: unknown };
    throw snapshotFolderUnreadableError(
      metaDir,
      error,
      typeof path === "string" ? path : metaDir
    );
  }
}

/** The migration a snapshot file is of, by base name. */
const migrationOf = (snapshotFile: string) =>
  snapshotFile.replace(/\.snapshot\.json$/, "");

/** A snapshot file's text; one that cannot be opened stops the run. */
async function snapshotText(metaDir: string, file: string): Promise<string> {
  try {
    return await readFile(resolve(metaDir, file), "utf-8");
  } catch (error) {
    throw snapshotFileUnreadableError(file, error);
  }
}

/** A snapshot file's text as JSON; text that is not stops the run. */
function parsedSnapshot(
  file: string,
  text: string
): LoadedSnapshot["snapshot"] {
  try {
    return JSON.parse(text) as LoadedSnapshot["snapshot"];
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw appliedSnapshotInvalidError(
      file,
      `JSON parse failed: ${detail}.`,
      error
    );
  }
}

/**
 * The snapshots of `removed`, the applied migrations whose file `migrate:resolve --removed` records
 * as removed on purpose. `loadSnapshots` leaves them out, as it reads a snapshot only with its
 * migration file beside it, and each is still what its migration left in the database.
 */
async function removedSnapshots(
  metaDir: string,
  files: readonly string[],
  removed: ReadonlySet<string>
): Promise<LoadedSnapshot[]> {
  return Promise.all(
    files
      .filter(file => removed.has(ledgerNameOfSnapshot(file)))
      .map(async file => ({
        file,
        snapshot: parsedSnapshot(file, await snapshotText(metaDir, file)),
        applied: true,
      }))
  );
}

/**
 * Stop over an applied migration's snapshot `loadSnapshots` left out: it cannot be opened, its
 * migration file is gone, or it does not hold JSON. It is opened first, so a snapshot removed
 * meanwhile is not said to be there.
 */
async function refuseUnreadSnapshot(
  metaDir: string,
  file: string
): Promise<never> {
  const text = await snapshotText(metaDir, file);
  const recorded = await snapshotsWithMigration(metaDir);
  if (!recorded.includes(file)) {
    throw appliedMigrationFileMissingError(file, migrationOf(file));
  }
  parsedSnapshot(file, text);
  throw snapshotReadFailedOnceError(file);
}

/**
 * Stop where a snapshot of an applied migration could not be read. `loadSnapshots` skips such a
 * file, and the next older record would then stand in for it. One whose migration has not been
 * applied says nothing about the database, so it may stay unreadable.
 */
async function assertAppliedSnapshotsRead(
  metaDir: string,
  listed: readonly string[],
  loaded: readonly LoadedSnapshot[],
  applied: ReadonlySet<string>
): Promise<void> {
  const read = new Set(loaded.map(snapshot => snapshot.file));
  const unread = listed.find(
    file => !read.has(file) && applied.has(ledgerNameOfSnapshot(file))
  );
  if (unread !== undefined) await refuseUnreadSnapshot(metaDir, unread);
}

/**
 * The entity record of the newest applied snapshot that has one, or undefined where none does.
 *
 * Its file is named beside it. A snapshot whose migration has not been applied is skipped, and so
 * is one written before
 * snapshots recorded entities: its silence says nothing about what was applied. One that has an
 * entity record this version cannot read stops the run rather than be passed over for an older one.
 */
function newestAppliedRecord(
  loaded: readonly LoadedSnapshot[]
):
  | { file: string; record: EntitySettingsRecord; snapshot: object }
  | undefined {
  // Ordered by recency, so the newest is the last one that qualifies.
  for (const { file, snapshot, applied } of [...loaded].reverse()) {
    if (!applied) continue;
    const parsed: unknown = snapshot;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw appliedSnapshotInvalidError(file, "It is not a snapshot.");
    }
    if (!Object.hasOwn(parsed, "entities")) continue;
    const record = (parsed as { entities?: unknown }).entities;
    if (isEntitySettingsRecord(record)) {
      return { file, record, snapshot: parsed };
    }
    throw appliedSnapshotInvalidError(
      file,
      "It records its entities in a shape that cannot be read."
    );
  }
  return undefined;
}

/** What the snapshots are read from, and the app's history check made among the reads. */
interface SnapshotArgs {
  adapter: DrizzleAdapter;
  dialect: SupportedDialect;
  migrationsDir: string;
  /** What the configuration and the manifest declare, of the one read of them. */
  declared: () => Promise<DeclaredNames>;
  checkHistory?: (declared: DeclaredNames) => Promise<void>;
}

/**
 * The localization migrations of the folder, by name, as the file this dialect runs says: another
 * dialect's variant says nothing of it.
 */
async function localizationMigrations(
  { migrationsDir, dialect }: Pick<SnapshotArgs, "migrationsDir" | "dialect">,
  declared: DeclaredNames
): Promise<ReadonlySet<string>> {
  const files = await readableMigrationFiles(migrationsDir, dialect, declared);
  return new Set(
    files
      .filter(file => file.content.includes(LOCALIZATION_MIGRATION_MARKER))
      .map(file => file.baseName)
  );
}

/**
 * Stop where an applied migration newer than `newest`, the one whose snapshot was read, has no
 * snapshot: the older one would stand in for it. A blank migration and a localization migration
 * have none by design, as `migrate:check` judges them, and an earlier Schema Builder's file is no
 * app migration, for any check. An older one says nothing here: the snapshot read records everything up to itself.
 */
async function assertNewestHasSnapshot(
  args: SnapshotArgs,
  read: {
    events: SchemaEventsRepository;
    rows: readonly SchemaEventRow[];
    newest: string;
    withSnapshot: ReadonlySet<string>;
    applied: ReadonlySet<string>;
  }
): Promise<void> {
  const { newest, withSnapshot } = read;
  const without = [...read.applied]
    .filter(
      name =>
        compareMigrationRecency(name, newest) > 0 && !withSnapshot.has(name)
    )
    .sort(compareMigrationRecency);
  if (without.length === 0) return;
  const { migrationsDir, dialect } = args;
  const declared = await args.declared();
  const [blank, oldBuilder] = await Promise.all([
    blankMigrationNames(migrationsDir, withSnapshot),
    readOldBuilderLedger(
      { migrationsDir, dialect, declared },
      read.events,
      read.rows
    ),
  ]);
  const localization = await localizationMigrations(args, {
    ...declared,
    ...(oldBuilder.marked !== undefined ? { marks: oldBuilder.marked } : {}),
  });
  const missing = without.filter(
    name =>
      !blank.has(name) &&
      !localization.has(name) &&
      !oldBuilder.ignoredRows.has(ledgerFilename(name))
  );
  if (missing.length > 0) throw appliedSnapshotsMissingError(missing, newest);
}

/**
 * Each entity as the newest applied snapshot that records entities holds it.
 *
 * Every snapshot records every collection, Single and field group there was when it was written,
 * whole, so that one snapshot is the applied definition of all of them. An entity it does not
 * record had been removed by then, and an older snapshot's record of it is out of date, so it has
 * no snapshot record at all.
 */
async function snapshotEntities(args: SnapshotArgs): Promise<SnapshotEntity[]> {
  const { adapter, dialect, migrationsDir } = args;
  // With no ledger nothing has been applied, so no snapshot speaks for the database.
  if (!(await adapter.tableExists("nextly_schema_events"))) return [];
  const events = new SchemaEventsRepository(adapter.getDrizzle(), dialect);
  // The ledger read once for every snapshot. A migration is applied where its latest outcome says
  // so, which is what `isFileApplied` asks of each file in turn: an attempt recorded after it that
  // failed, stopped or was cleared leaves it applied, and its snapshot the newest.
  const rows = await events.listFileApplies();
  const migrations = appliedAppMigrations(rows);
  const applied = new Set([...migrations].map(ledgerFilename));
  const removed = removedOnPurpose(rows, await events.listFileRemovals());
  const metaDir = resolve(migrationsDir, "meta");
  const [listed, withFile] = await Promise.all([
    snapshotFiles(metaDir),
    loadSnapshots({
      migrationsDir,
      isApplied: file => Promise.resolve(applied.has(file)),
    }),
  ]);
  const read = new Set(withFile.map(snapshot => snapshot.file));
  const unread = listed.filter(file => !read.has(file));
  const loaded = [
    ...withFile,
    ...(await removedSnapshots(metaDir, unread, removed)),
  ].sort((a, b) =>
    compareMigrationRecency(migrationOf(a.file), migrationOf(b.file))
  );
  await assertAppliedSnapshotsRead(metaDir, listed, loaded, applied);
  const newest = newestAppliedRecord(loaded);
  // Asked here, so a snapshot that is there is judged as what it is first, and every migration
  // judged below is one the folder holds or whose removal is recorded.
  await args.checkHistory?.(await args.declared());
  if (newest === undefined) return [];
  await assertNewestHasSnapshot(args, {
    events,
    rows,
    newest: migrationOf(newest.file),
    withSnapshot: new Set(listed.map(migrationOf)),
    applied: migrations,
  });
  return recordedEntities(newest.record, recordedColumnTypes(newest.snapshot));
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

/**
 * A configured field group at the table the registry stores it in, which is `fg_<slug>` on a site
 * on the current names: no configuration names a field group's table, so none of its migrations
 * moves it. Every other entity as configured.
 */
function atStoredTable(
  entity: ConfiguredEntity,
  registry: readonly RegistryEntity[]
): ConfiguredEntity {
  if (entity.kind !== "fieldGroup") return entity;
  const table = registry.find(
    row => row.kind === "fieldGroup" && row.slug === entity.slug
  )?.tableName;
  return table === undefined ? entity : { ...entity, table };
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
  /**
   * The run's waits for a table another session is using. On SQLite, where another connection can
   * hold the whole database, the database's reads run in its tries; where they run out, only the
   * configuration is read, and every column it names is reported as one whose definition could
   * not be read (the run's later reads take the same, spent, tries).
   */
  waits?: TableWaits;
  /** The app's column overrides, as the configuration declares them. */
  overrides?: RepairOverrides;
  /**
   * Refuses where the app's history does not hold: the folder lacks a migration the database has
   * applied, or an attempt at one may have stopped part-way. The caller has the checks. It is
   * handed the names the configuration and the manifest declare, which tell an old Schema Builder
   * file.
   */
  checkHistory?: (declared: DeclaredNames) => Promise<void>;
}): Promise<RepairEntity[]> {
  const { adapter, dialect, logger } = args;
  const codeFields = args.config.users?.fields ?? [];
  // Independent reads, so none waits on another.
  // Read once: the entities compared and the names the checks are made with are of one read.
  const configuration = configuredEntities(args);
  const fromDatabase = () =>
    Promise.all([
      registryEntities(adapter, logger),
      snapshotEntities({
        ...args,
        declared: async () => (await configuration).declared,
      }),
      userFieldSources(adapter, dialect, logger, codeFields),
    ]);
  const [{ entities: configured, hasManifest }, read] = await Promise.all([
    configuration,
    args.waits === undefined || dialect !== "sqlite"
      ? fromDatabase().then(value => ({ kind: "done" as const, value }))
      : // SQLite's tries are the whole database's, whichever table names them.
        args.waits.read(REGISTRY_READ, fromDatabase),
  ]);
  if (read.kind === "ran-out") {
    return resolveRepairEntities({
      configured,
      hasManifest,
      registry: [],
      snapshots: [],
      userFields: { stored: null, configured: codeFields },
      ...(args.overrides !== undefined ? { overrides: args.overrides } : {}),
    });
  }
  const [registry, snapshots, userFields] = read.value;
  return resolveRepairEntities({
    configured: configured.map(entity => atStoredTable(entity, registry)),
    hasManifest,
    registry,
    snapshots,
    userFields,
    ...(args.overrides !== undefined ? { overrides: args.overrides } : {}),
  });
}
