// Which entities `nextly repair-columns` compares, and the definition each is judged against.
//
// A column is judged against its field as the database last had it applied. Nothing in the
// database records that today: the registry row is rewritten from the configuration at each start
// (code-first) or at each Schema Builder save (which also marks it pending). What does record it is
// the migration snapshot beside each applied migration, so that comes first:
//
// 1. the newest applied migration snapshot that records entities, where it records this one;
// 2. where it does not (a site with no migration files, only files written before snapshots
//    recorded entities, or an entity that snapshot no longer records), the registry row; a row still waiting for a migration then leaves the
//    applied definition unknown, which the finder reports as pending rather than judging;
// 3. where there is no row either, the configuration, the only definition there is.
//
// Once `nextly migrate` writes the registry from the applied snapshots, (1) and (2) agree, so the
// order gives the same answer then as it does now.
//
// Pure: the command reads the configuration, the registry and the snapshots, and hands them here.
//
// @module domains/schema/repair-columns/resolve-entities

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { builtByFor, isCodeOwned } from "../pipeline/registered-collections";

import type { RepairEntity } from "./types";

/** The three kinds of entity a registry row and a snapshot record. */
type RecordedKind = "collection" | "single" | "fieldGroup";

/** An entity the configuration declares, with its table name resolved. */
export interface ConfiguredEntity {
  kind: RecordedKind;
  slug: string;
  table: string;
  fields: readonly unknown[];
  localized: boolean;
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

/**
 * Who built the table: the registry's ownership where there is a row, else who declared it when
 * the snapshot was written, else code-first, which every configured entity is.
 */
function isBuilderOwned({ row, recorded }: EntitySources): boolean {
  if (row !== undefined) {
    return !isCodeOwned({ locked: row.locked, source: row.source });
  }
  return recorded !== undefined && recorded.source === "builder";
}

/**
 * The definition the entity's columns are judged against: the newest applied snapshot's, else the
 * registry row's, else the configuration's, in the order the module header gives.
 */
function appliedDefinition({
  fromConfig,
  row,
  recorded,
}: EntitySources): RepairEntity["applied"] {
  if (recorded !== undefined) {
    return {
      fields: asFields(recorded.fields),
      localized: recorded.localized,
      source: "snapshot",
    };
  }
  if (row !== undefined) {
    return {
      fields: asFields(row.fields),
      localized: row.localized === true,
      source: "registry",
    };
  }
  return {
    fields: asFields(fromConfig?.fields),
    localized: fromConfig?.localized === true,
    source: "configuration",
  };
}

/**
 * The definition the configuration holds now, which a pending change is found against.
 *
 * A Builder entity is not in the configuration: the row the Builder saved is its configured
 * definition. A code-first entity the configuration no longer declares has none.
 */
function configuredDefinition(
  { fromConfig, row }: EntitySources,
  builderOwned: boolean
): RepairEntity["configured"] {
  if (fromConfig !== undefined) {
    return {
      fields: asFields(fromConfig.fields),
      localized: fromConfig.localized,
    };
  }
  if (row !== undefined && builderOwned) {
    return { fields: asFields(row.fields), localized: row.localized === true };
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

/**
 * Whether the applied definition is unknown: the registry row waits for a migration and no applied
 * snapshot says what the entity was before it.
 */
function isAwaitingMigration({ row, recorded }: EntitySources): boolean {
  return recorded === undefined && row?.migrationStatus === "pending";
}

/** One entity, from what each source records of it, or null where it cannot be compared. */
function resolveEntity(sources: EntitySources): RepairEntity | null {
  const identity = sources.fromConfig ?? sources.row ?? sources.recorded;
  const table = tableOf(sources);
  // An entity whose table nothing names cannot be compared; every source that records one names
  // it, so this is only a guard against a malformed row.
  if (identity === undefined || table === undefined) return null;

  const builderOwned = isBuilderOwned(sources);
  const plugin = owningPlugin(sources);
  return {
    kind: identity.kind,
    slug: identity.slug,
    table,
    origin: builtByFor(identity.kind, builderOwned),
    applied: appliedDefinition(sources),
    configured: configuredDefinition(sources, builderOwned),
    awaitingMigration: isAwaitingMigration(sources),
    ...(plugin !== undefined ? { plugin } : {}),
  };
}

/** The `user_ext` entity, whose applied definition is the stored user field definitions. */
function userFieldsEntity(userFields: readonly unknown[]): RepairEntity {
  return {
    kind: "userFields",
    slug: "users",
    table: USER_FIELDS_TABLE,
    origin: "userFields",
    applied: {
      fields: asFields(userFields),
      localized: false,
      source: "registry",
    },
    // No record says which user fields were applied apart from the definitions themselves, so
    // there is nothing to tell a pending change from.
    configured: null,
    awaitingMigration: false,
  };
}

/**
 * One entity per kind and slug, in the order they are first seen: configuration, then registry,
 * then snapshots. `userFields` is the stored user field definitions, or null where they could not
 * be read; user fields are recorded nowhere else, so they are judged against those definitions.
 */
export function resolveRepairEntities(args: {
  configured: readonly ConfiguredEntity[];
  registry: readonly RegistryEntity[];
  snapshots: readonly SnapshotEntity[];
  userFields?: readonly unknown[] | null;
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

  if (args.userFields !== undefined && args.userFields !== null) {
    entities.push(userFieldsEntity(args.userFields));
  }
  return entities;
}
