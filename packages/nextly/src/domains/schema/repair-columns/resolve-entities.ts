// Which entities `nextly repair-columns` compares, and the definitions each is judged against.
//
// A column is judged against its field as the database last had it applied. Nothing in the
// database records that today: the registry row is rewritten from the configuration at each start
// (code-first) or at each Schema Builder save (which also marks it pending). What does record it is
// the migration snapshot beside each applied migration, so that comes first:
//
// 1. the newest applied migration snapshot that records entities, where it records this one;
// 2. where it does not (a site with no migration files, only files written before snapshots
//    recorded entities, or an entity that snapshot no longer records), the registry row, where a
//    sync or a migration finished it (`applied` or `synced`);
// 3. where there is no such row either (none, or one that waits for a migration, has one generated
//    and not applied, or failed), nothing says what was applied: the applied definition is null,
//    and the finder reports every configured column as pending rather than judging any against a
//    definition no migration has applied.
//
// Once `nextly migrate` writes the registry from the applied snapshots, (1) and (2) agree, so the
// order gives the same answer then as it does now.
//
// The configured definition is what the next migration would apply: the configuration's for a
// code-first entity, and the Builder manifest's for a Builder entity. Where a manifest is checked
// out, a Builder entity it leaves out is one the next migration removes, so it has no configured
// definition. Only a project with no manifest at all has the registry row the Builder saved stand
// in for it. Each side carries the builder that makes its tables, since the two can differ.
//
// Each side names its own table too. A code-first `dbName` change rewrites the registry row's table
// at the next start, while the database keeps the old table, which the applied snapshot records,
// until the rename's migration applies: the entity stays at the applied side's table, and the
// configured side's is named as where that migration moves it.
//
// Pure: the command reads the configuration, the manifest, the registry and the snapshots, and
// hands them here.
//
// @module domains/schema/repair-columns/resolve-entities

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { ColumnOverride } from "../extension/draft";
import { builtByFor, isCodeOwned } from "../pipeline/registered-collections";
import type { ColumnOrigin } from "../services/field-column-descriptor";

import type {
  AppliedDefinition,
  EntityDefinition,
  RepairEntity,
} from "./types";

/** The three kinds of entity a registry row and a snapshot record. */
type RecordedKind = "collection" | "single" | "fieldGroup";

/** An entity the configuration or the Builder manifest declares, with its table name resolved. */
export interface ConfiguredEntity {
  kind: RecordedKind;
  slug: string;
  table: string;
  fields: readonly unknown[];
  localized: boolean;
  /** The builder that will make its tables: code-first for the configuration's, else the Builder's. */
  origin: ColumnOrigin;
  /** The plugin that contributed the entity, when one did. */
  plugin?: string;
}

/** A registry row, as much of it as the resolution reads. */
export interface RegistryEntity {
  kind: RecordedKind;
  slug: string;
  tableName?: string;
  fields?: readonly unknown[];
  localized?: boolean;
  /** `code`, `ui`, `built-in` or `plugin:<name>`. */
  source?: string;
  locked?: boolean;
  /**
   * `applied` or `synced` once a migration or a sync finished the entity; `pending` while a change
   * waits for its migration, `generated` while that migration is written and not applied, `failed`
   * where an apply did not finish.
   */
  migrationStatus?: string;
}

/** An entity as the newest applied migration snapshot that records entities holds it. */
export interface SnapshotEntity {
  kind: RecordedKind;
  slug: string;
  /** Who declared it when the snapshot was written. */
  source: "code" | "builder";
  fields: readonly unknown[];
  localized: boolean;
  /** Its table, where the snapshot's settings name one. */
  table?: string;
  /**
   * The type the snapshot recorded for each column of that table, by column name: what its
   * migration applied, an override of the app's included.
   */
  columnTypes?: Readonly<Record<string, string>>;
}

/** The app's overrides as the configuration declares them now. */
export interface RepairOverrides {
  byTable: ReadonlyMap<string, readonly ColumnOverride[]>;
}

const PLUGIN_SOURCE = "plugin:";

/** The table `user_ext` user fields are stored in, which only the user-extension builder creates. */
const USER_FIELDS_TABLE = "user_ext";

const asFields = (fields: readonly unknown[] | undefined) =>
  (fields ?? []) as readonly FieldDefinition[];

/** What each source records of one entity; a source that does not record it holds undefined. */
interface EntitySources {
  fromConfig: ConfiguredEntity | undefined;
  row: RegistryEntity | undefined;
  recorded: SnapshotEntity | undefined;
}

/** An entity no source has recorded yet. */
const NO_SOURCES: EntitySources = {
  fromConfig: undefined,
  row: undefined,
  recorded: undefined,
};

/** The registry statuses that say the row's definition is in the database. */
const APPLIED_STATUSES: ReadonlySet<string | undefined> = new Set([
  "applied",
  "synced",
]);

/** Whether a Builder manifest is checked out, which decides what a Builder registry row stands for. */
interface ResolutionContext {
  hasManifest: boolean;
}

/** Whether the Builder owns a registry row, from the ownership the registry recorded. */
const isBuilderRow = (row: RegistryEntity) =>
  !isCodeOwned({ locked: row.locked, source: row.source });

/**
 * The definition the entity's columns are judged against: the newest applied snapshot's, else the
 * registry row's, in the order the module header gives, or null where neither says what was applied.
 *
 * Each names the builder that made the tables as it recorded the owner: the snapshot by who declared
 * the entity when it was written, the row by the registry's ownership.
 */
function appliedDefinition({
  row,
  recorded,
}: EntitySources): AppliedDefinition | null {
  if (recorded !== undefined) {
    return {
      fields: asFields(recorded.fields),
      localized: recorded.localized,
      origin: builtByFor(recorded.kind, recorded.source === "builder"),
      source: "snapshot",
    };
  }
  // Any other row describes what a migration will apply, or one that did not finish, not what was.
  if (row === undefined || !APPLIED_STATUSES.has(row.migrationStatus)) {
    return null;
  }
  return {
    fields: asFields(row.fields),
    localized: row.localized === true,
    origin: builtByFor(row.kind, isBuilderRow(row)),
    source: "registry",
  };
}

/**
 * The definition the next migration would apply, which a pending change is found against.
 *
 * The configuration's or the manifest's where either declares the entity. A Builder entity a
 * checked-out manifest leaves out has none: that migration removes it. With no manifest at all, a
 * Builder entity has the row the Builder saved. A code-first entity the configuration no longer
 * declares has none.
 */
function configuredDefinition(
  { fromConfig, row }: EntitySources,
  { hasManifest }: ResolutionContext
): EntityDefinition | null {
  if (fromConfig !== undefined) {
    return {
      fields: asFields(fromConfig.fields),
      localized: fromConfig.localized,
      origin: fromConfig.origin,
    };
  }
  if (!hasManifest && row !== undefined && isBuilderRow(row)) {
    return {
      fields: asFields(row.fields),
      localized: row.localized === true,
      origin: builtByFor(row.kind, true),
    };
  }
  return null;
}

/** The plugin that owns the entity: the one its registry row names, else the configuration's. */
function owningPlugin({ fromConfig, row }: EntitySources): string | undefined {
  return row?.source?.startsWith(PLUGIN_SOURCE)
    ? row.source.slice(PLUGIN_SOURCE.length)
    : fromConfig?.plugin;
}

/**
 * The table the applied definition's columns are in: the one the snapshot's migration created
 * where a snapshot says what was applied, else the one the registry row names. A snapshot that
 * names none leaves it to the row.
 */
function appliedTableOf(
  applied: AppliedDefinition,
  { row, recorded }: EntitySources
): string | undefined {
  return applied.source === "snapshot"
    ? (recorded?.table ?? row?.tableName)
    : row?.tableName;
}

/**
 * The table the next migration would have the entity at: the configuration's or the manifest's,
 * else the registry row's, which is the one a row standing in as configured names.
 */
function configuredTableOf({ fromConfig, row }: EntitySources) {
  return fromConfig?.table ?? row?.tableName;
}

/**
 * What an applied definition says of the app's overrides. Where a snapshot says what was applied,
 * the column types it recorded, which carry the storage its migration gave each overridden column
 * whatever the configuration declares since; a change to an override is then a change still
 * pending, as a field's is. Where a registry row does, the configuration's overrides: only a
 * development push writes such a row, and it applies the configuration as it stands. Where nothing
 * configures the entity any more, the overrides went with its declaration, so which storage was
 * applied is unknown rather than the fields' own.
 */
function withAppliedStorage(
  applied: AppliedDefinition | null,
  sources: EntitySources,
  configured: readonly ColumnOverride[],
  isConfigured: boolean
): AppliedDefinition | null {
  if (applied === null) return null;
  if (applied.source === "snapshot") {
    const recorded = sources.recorded?.columnTypes;
    return recorded === undefined
      ? applied
      : { ...applied, recordedTypes: recorded };
  }
  if (!isConfigured) return { ...applied, storageUnknown: true };
  return withOverrides(applied, configured);
}

/** `definition` carrying `overrides`, or as it is where there are none. */
function withOverrides<D extends EntityDefinition>(
  definition: D | null,
  overrides: readonly ColumnOverride[]
): D | null {
  if (definition === null || overrides.length === 0) return definition;
  return { ...definition, columnOverrides: overrides };
}

/** One entity, from what each source records of it, or null where it cannot be compared. */
function resolveEntity(
  sources: EntitySources,
  overrides: RepairOverrides | undefined,
  context: ResolutionContext
): RepairEntity | null {
  const identity = sources.fromConfig ?? sources.row ?? sources.recorded;
  if (identity === undefined) return null;
  const appliedSide = appliedDefinition(sources);
  const configuredSide = configuredDefinition(sources, context);
  // A row waiting for a migration that nothing declares any more: nothing says what was applied
  // or what will be, so there is nothing to compare its columns with.
  if (appliedSide === null && configuredSide === null) return null;

  const configuredTable =
    configuredSide === null ? undefined : configuredTableOf(sources);
  // The entity is where the database holds it: at the applied side's table, or, where nothing was
  // applied, at the one the next migration would create.
  const table =
    (appliedSide === null ? undefined : appliedTableOf(appliedSide, sources)) ??
    configuredTable;
  // An entity whose table nothing names cannot be compared; every source that records one names
  // it, and the reader refuses a registry row that does not, so this is only a guard.
  if (table === undefined) return null;

  // The app declares an override by the table it configures, which a rename has already moved.
  const declared = overrides?.byTable.get(configuredTable ?? table) ?? [];
  const applied = withAppliedStorage(
    appliedSide,
    sources,
    declared,
    configuredSide !== null
  );
  const configured = withOverrides(configuredSide, declared);
  const plugin = owningPlugin(sources);
  return {
    kind: identity.kind,
    slug: identity.slug,
    table,
    // Named only where the next migration moves the entity to another table.
    ...(configuredTable !== undefined && configuredTable !== table
      ? { renamedTo: configuredTable }
      : {}),
    applied,
    configured,
    ...(plugin !== undefined ? { plugin } : {}),
  };
}

/**
 * The user fields `user_ext` is built from: as stored in the definitions, and as the next sync
 * would store them.
 */
export interface UserFieldSources {
  /** The stored user field definitions, or null where the database has no definitions table. */
  stored: readonly unknown[] | null;
  /** The configuration's code fields, then the stored fields the admin added. */
  configured: readonly unknown[];
}

/** A user field list as the user-extension builder makes `user_ext` from it. */
const userFieldsDefinition = (
  fields: readonly unknown[]
): EntityDefinition => ({
  fields: asFields(fields),
  localized: false,
  origin: "userFields",
});

/**
 * The `user_ext` entity, whose applied definition is the stored user field definitions: no other
 * record says which user fields were applied. With none stored, they await a migration.
 */
function userFieldsEntity(userFields: UserFieldSources): RepairEntity | null {
  if (userFields.stored === null && userFields.configured.length === 0) {
    return null;
  }
  return {
    kind: "userFields",
    slug: "users",
    table: USER_FIELDS_TABLE,
    applied:
      userFields.stored === null
        ? null
        : { ...userFieldsDefinition(userFields.stored), source: "registry" },
    configured: userFieldsDefinition(userFields.configured),
  };
}

/**
 * One entity per kind and slug, in the order they are first seen: configuration, then registry,
 * then snapshots, and the user fields last. `userFields` is absent where they could not be read.
 * `hasManifest` says whether a Builder manifest is checked out: where one is, `configured` holds
 * every Builder entity the next migration would apply, and a Builder row it leaves out is a
 * removal. Absent, none is checked out.
 */
export function resolveRepairEntities(args: {
  configured: readonly ConfiguredEntity[];
  registry: readonly RegistryEntity[];
  snapshots: readonly SnapshotEntity[];
  userFields?: UserFieldSources;
  /** The app's column overrides; absent, none is declared. */
  overrides?: RepairOverrides;
  hasManifest?: boolean;
}): RepairEntity[] {
  // One record per entity, in the order it is first seen, each source adding what it records.
  const byEntity = new Map<string, EntitySources>();
  const add = (
    entity: { kind: RecordedKind; slug: string },
    source: Partial<EntitySources>
  ) => {
    const key = `${entity.kind}\u0000${entity.slug}`;
    byEntity.set(key, {
      ...(byEntity.get(key) ?? NO_SOURCES),
      ...source,
    });
  };
  for (const e of args.configured) add(e, { fromConfig: e });
  for (const e of args.registry) add(e, { row: e });
  for (const e of args.snapshots) add(e, { recorded: e });

  const entities: RepairEntity[] = [];
  for (const sources of byEntity.values()) {
    const entity = resolveEntity(sources, args.overrides, {
      hasManifest: args.hasManifest === true,
    });
    if (entity !== null) entities.push(entity);
  }

  const users =
    args.userFields === undefined ? null : userFieldsEntity(args.userFields);
  if (users !== null) entities.push(users);
  return entities;
}
