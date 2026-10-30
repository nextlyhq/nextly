// Which entities `nextly repair-columns` compares, and the definitions each is judged against.
//
// A column is judged against its field as the database last had it applied. Nothing in the
// database records that today: the registry row is rewritten from the configuration at each start
// (code-first) or at each Schema Builder save (which also marks it pending). What does record it is
// the migration snapshot beside each applied migration, so that comes first:
//
// 1. the newest applied migration snapshot that records entities, where it records this one;
// 2. where it does not (a site with no migration files, only files written before snapshots
//    recorded entities, or an entity that snapshot no longer records), the registry row;
// 3. where there is no row either, or the row still waits for a migration, nothing says what was
//    applied: the entity awaits a migration, and the finder reports its columns as pending rather
//    than judging them against a definition no migration has applied.
//
// Once `nextly migrate` writes the registry from the applied snapshots, (1) and (2) agree, so the
// order gives the same answer then as it does now.
//
// The configured definition is what the next migration would apply: the configuration's for a
// code-first entity, the Builder manifest's for a Builder entity it declares, else the registry row
// the Builder saved. Each side carries the builder that makes its tables, since the two can differ.
//
// Pure: the command reads the configuration, the manifest, the registry and the snapshots, and
// hands them here.
//
// @module domains/schema/repair-columns/resolve-entities

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
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
  /** `pending` while a Builder change waits for its migration. */
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
  // A row waiting for its migration describes what that migration will apply, not what was.
  if (row === undefined || row.migrationStatus === "pending") return null;
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
 * The configuration's or the manifest's where either declares the entity. A Builder entity no
 * manifest declares has the row the Builder saved. A code-first entity the configuration no longer
 * declares has none.
 */
function configuredDefinition({
  fromConfig,
  row,
}: EntitySources): EntityDefinition | null {
  if (fromConfig !== undefined) {
    return {
      fields: asFields(fromConfig.fields),
      localized: fromConfig.localized,
      origin: fromConfig.origin,
    };
  }
  if (row !== undefined && isBuilderRow(row)) {
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

/** The table the entity's columns are in, as the first source that names it gives it. */
function tableOf({ fromConfig, row, recorded }: EntitySources) {
  return row?.tableName ?? recorded?.table ?? fromConfig?.table;
}

/** One entity, from what each source records of it, or null where it cannot be compared. */
function resolveEntity(sources: EntitySources): RepairEntity | null {
  const identity = sources.fromConfig ?? sources.row ?? sources.recorded;
  const table = tableOf(sources);
  // An entity whose table nothing names cannot be compared; every source that records one names
  // it, so this is only a guard against a malformed row.
  if (identity === undefined || table === undefined) return null;

  const applied = appliedDefinition(sources);
  const configured = configuredDefinition(sources);
  // A code-first row waiting for a migration the configuration no longer declares: nothing says
  // what was applied or what will be, so there is nothing to compare its columns with.
  if (applied === null && configured === null) return null;

  const plugin = owningPlugin(sources);
  return {
    kind: identity.kind,
    slug: identity.slug,
    table,
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
 */
export function resolveRepairEntities(args: {
  configured: readonly ConfiguredEntity[];
  registry: readonly RegistryEntity[];
  snapshots: readonly SnapshotEntity[];
  userFields?: UserFieldSources;
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
    const entity = resolveEntity(sources);
    if (entity !== null) entities.push(entity);
  }

  const users =
    args.userFields === undefined ? null : userFieldsEntity(args.userFields);
  if (users !== null) entities.push(users);
  return entities;
}
