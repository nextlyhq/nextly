/**
 * How `nextly migrate` keeps a database's field-group storage and the project's migration history
 * on the same names.
 *
 * The history records its naming in each snapshot (`snapshotFieldGroupNaming`), and the database
 * says its own by which registry it holds (`dynamic_components` or `dynamic_field_groups`). The two
 * meet at the transition file `nextly migrate:create --field-group-names=current` writes: it holds
 * no statement, so applying it only records that the database already moved. The storage itself
 * moves through `nextly migrate:field-groups`, never inside `nextly migrate`.
 *
 * @module domains/schema/migrate/field-group-history
 */

import { NextlyError } from "../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { retargetName } from "../../field-groups/migration/manifest";
import { MIGRATION_TARGET } from "../../field-groups/migration/target";
import {
  CURRENT_NAMES_SHOWN,
  LEGACY_NAMES_SHOWN,
} from "../../field-groups/services/field-group-names-shown";
import {
  namingOfRegistry,
  type FieldGroupNaming,
} from "../../field-groups/services/field-group-storage-names";
import {
  readStoredFieldGroupTables,
  type RegistryReadAdapter,
} from "../../field-groups/services/field-group-stored-tables";
import {
  resolveRegistryNameFromCatalog,
  type CatalogReadAdapter,
} from "../../field-groups/storage/resolve-storage-names";
import {
  FIELD_GROUP_STORAGE_MIGRATION_COMMAND,
  FIELD_GROUP_TRANSITION_COMMAND,
  snapshotUnderCurrentNames,
} from "../migrate-create/field-group-names-transition";
import {
  snapshotFieldGroupNaming,
  type SnapshotFile,
} from "../migrate-create/snapshot-io";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import { resolveComponentTableName } from "../utils/resolve-table-name";

/**
 * `snapshots` as a database whose field groups moved to the current names holds them: each legacy
 * snapshot's field-group tables (`comp_<slug>`) under their current names, with the current type
 * column, as `nextly migrate:field-groups` renamed them. Unchanged on a legacy database, and for a
 * snapshot already on the current names. What the database is compared with while the history's
 * move to the current names is still pending.
 */
export async function underDatabaseFieldGroupNames<
  T extends {
    snapshot: NextlySchemaSnapshot;
    fieldGroupNaming?: FieldGroupNaming;
  },
>(
  adapter: CatalogReadAdapter & RegistryReadAdapter,
  snapshots: readonly T[]
): Promise<T[]> {
  if (!snapshots.some(entry => entry.fieldGroupNaming !== "current")) {
    return [...snapshots];
  }
  if ((await databaseFieldGroupNaming(adapter)) === "legacy") {
    return [...snapshots];
  }
  // Which tables are field groups' is read from the moved registry, never from the `comp_` prefix,
  // which a collection's own table name may share.
  const groupTables = movedGroupTables(
    (await readStoredFieldGroupTables(adapter)).tables
  );
  return snapshots.map(entry => {
    if (entry.fieldGroupNaming === "current") return entry;
    return {
      ...entry,
      snapshot: snapshotUnderCurrentNames(entry.snapshot, groupTables),
    };
  });
}

/**
 * Each field-group table's current name, by its legacy one, for the groups a moved registry
 * holds (slug to stored table), by the storage migration's own rule (`retargetName`): a group
 * whose stored table is its slug's renamed name was `comp_<slug>`; a table under a name its
 * author chose, `fg_` prefix or not, kept that name, and only its type column moved.
 */
function movedGroupTables(
  stored: ReadonlyMap<string, string>
): ReadonlyMap<string, string> {
  return new Map(
    [...stored.entries()].map(([slug, table]) => {
      const derived = resolveComponentTableName(slug);
      const renamed = retargetName({ slug, tableName: derived });
      return [renamed === table ? derived : table, table];
    })
  );
}

/** The names the database keeps its field groups under, read from its registry in the catalog. */
async function databaseFieldGroupNaming(
  adapter: CatalogReadAdapter
): Promise<FieldGroupNaming> {
  return namingOfRegistry(await resolveRegistryNameFromCatalog(adapter));
}

/**
 * Whether a migration is the first of the history on the current field-group names: its snapshot
 * records `current` and the snapshot before it does not, or there is none before it (a history
 * that starts on the current names, as `migrate:baseline` of a moved database writes one). Either
 * way it applies only to a database whose field groups are on the current names.
 */
export function isFieldGroupTransition(
  before: Pick<
    SnapshotFile,
    "fieldGroupStorage" | "snapshot" | "migration"
  > | null,
  target: Pick<
    SnapshotFile,
    "fieldGroupStorage" | "snapshot" | "migration"
  > | null
): boolean {
  return (
    target !== null &&
    snapshotFieldGroupNaming(target) === "current" &&
    (before === null || snapshotFieldGroupNaming(before) === "legacy")
  );
}

/**
 * Refuses the transition file on a database whose field groups are still on the legacy names,
 * before anything is recorded. The file holds no statement, so without this it would read as in
 * step with a legacy database (whose tables match the snapshot before it, renamed or not, when the
 * project has no field group) and be recorded, leaving every later file planned against tables
 * the database does not have.
 */
export async function refuseFieldGroupTransitionOnLegacy(
  adapter: CatalogReadAdapter,
  filename: string,
  /** Whether the history has no snapshot before the file: it begins on the current names. */
  beginsHistory: boolean
): Promise<void> {
  if ((await databaseFieldGroupNaming(adapter)) === "current") return;
  throw beginsHistory
    ? fieldGroupHistoryBeginsOnCurrentError(filename)
    : fieldGroupStorageNotMigratedError(filename);
}

/**
 * The refusal of a history that begins on the current names, on a database whose field groups are
 * on the legacy ones. Its first file was written where this database could not be read, or records
 * a database that moved: which of the two, only its author can tell.
 */
export function fieldGroupHistoryBeginsOnCurrentError(
  filename: string
): NextlyError {
  return new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      `${filename} begins the migration history on the current field-group names (${CURRENT_NAMES_SHOWN}), and this database's field groups are on the legacy ones (${LEGACY_NAMES_SHOWN}). ` +
      "Applying it would record names the database does not have. " +
      "It was not applied. If no database has applied it, delete it with its snapshot and the translations migrations written with it, and run `nextly migrate:create` again where this database can be reached: it is then written under the names this database holds. " +
      `If another database has applied it, move this one's field groups with \`${FIELD_GROUP_STORAGE_MIGRATION_COMMAND}\`, then run \`nextly migrate\` again. ` +
      `The moved tables keep their earlier index names, so where \`nextly migrate\` then says the database already stands where the file ends, record it with \`nextly migrate:resolve --applied ${filename.replace(/\.sql$/, "")}\` and run \`nextly migrate\` once more.`,
    logContext: {
      reason: "field-group-storage-not-migrated",
      file: filename,
    },
  });
}

/**
 * Refuses to record a file on the current field-group names as applied on a database whose field
 * groups are still on the legacy ones (`nextly migrate:resolve --applied`). It is the rule
 * `nextly migrate` holds the transition to, for any file on those names: recorded, every later file
 * would be planned against storage the database does not have. A file that does not say it is on
 * the current names says nothing here.
 */
export async function refuseCurrentNamesOnLegacyStorage(
  adapter: CatalogReadAdapter,
  filename: string,
  naming: FieldGroupNaming | null
): Promise<void> {
  if (naming !== "current") return;
  if ((await databaseFieldGroupNaming(adapter)) === "current") return;
  throw currentNamesNotRecordedError(filename);
}

/** The refusal to record a current-name file applied on legacy storage. */
export function currentNamesNotRecordedError(filename: string): NextlyError {
  return new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      `${filename} is on the current field-group names (${CURRENT_NAMES_SHOWN}), and this database's field groups are still on the legacy ones (${LEGACY_NAMES_SHOWN}). ` +
      "Recording it as applied would say the database moved when it has not. " +
      `Nothing was recorded. Move the field groups with \`${FIELD_GROUP_STORAGE_MIGRATION_COMMAND}\`, then run \`nextly migrate\`.`,
    logContext: {
      reason: "field-group-storage-not-migrated",
      file: filename,
    },
  });
}

/** The refusal of the transition file on a database whose field groups have not moved. */
export function fieldGroupStorageNotMigratedError(
  filename: string
): NextlyError {
  return new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      `${filename} moves the migration history to the current field-group names (${CURRENT_NAMES_SHOWN}), and this database's field groups are still on the legacy ones (${LEGACY_NAMES_SHOWN}). ` +
      "Applying it would record a move the database has not made. " +
      `It was not applied. Move the field groups with \`${FIELD_GROUP_STORAGE_MIGRATION_COMMAND}\`, then run \`nextly migrate\` again.`,
    logContext: {
      reason: "field-group-storage-not-migrated",
      file: filename,
    },
  });
}

/**
 * Refuses a database whose field groups moved to the current names while the project's history,
 * up to its newest applied file, is still on the legacy ones, unless the next file to apply is the
 * one that moves the history: applying it settles the two. Any other pending file is still planned
 * against the legacy names the database no longer has, so the run stops before it. Read before the
 * database is compared with its newest applied file, which would otherwise name every `comp_`
 * table as missing.
 */
export async function refuseMovedStorageBehindLegacyHistory(args: {
  adapter: CatalogReadAdapter;
  newestApplied: FieldGroupNaming;
  /** The naming the next app file to apply records, where there is one with a snapshot. */
  nextPending: FieldGroupNaming | undefined;
}): Promise<void> {
  if (args.newestApplied === "current") return;
  if ((await databaseFieldGroupNaming(args.adapter)) === "legacy") return;
  if (args.nextPending === "current") return;
  throw fieldGroupHistoryBehindStorageError();
}

/** The refusal of a database whose field groups moved ahead of a legacy history. */
export function fieldGroupHistoryBehindStorageError(): NextlyError {
  return new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      `This database's field groups were moved to the current names (${CURRENT_NAMES_SHOWN}), and the project's migration history is still on the legacy ones (${LEGACY_NAMES_SHOWN}). ` +
      "Every file after this point would be planned against tables the database no longer has. " +
      `No file was applied. Run \`${FIELD_GROUP_TRANSITION_COMMAND}\`, then \`nextly migrate\` again.`,
    logContext: { reason: "field-group-history-behind-storage" },
  });
}

/**
 * Refuses a database whose field groups moved to the current names and that holds a field-group
 * table still on the legacy type column (`_component_type`), where the history the database is
 * held to records that table with the current one. Such a table was created by an earlier release
 * after the move, so the storage migration never renamed its column, and the history, read under
 * the database's names, says it was renamed: every file planned from it would address a column
 * the table does not have.
 *
 * `snapshots` are what the run holds the database to: the newest applied file's, and the next
 * file's where it is the one that moves the history. A history that records the column the table
 * holds, as a baseline of the database does, is not refused.
 */
export async function refuseTypeColumnsHistoryDoesNotRecord(args: {
  adapter: CatalogReadAdapter & RegistryReadAdapter;
  snapshots: readonly {
    snapshot: NextlySchemaSnapshot;
    fieldGroupNaming?: FieldGroupNaming;
  }[];
}): Promise<void> {
  if (args.snapshots.length === 0) return;
  if ((await databaseFieldGroupNaming(args.adapter)) === "legacy") return;
  const stored = [
    ...(await readStoredFieldGroupTables(args.adapter)).tables.values(),
  ];
  const live = await introspectLiveColumns(
    args.adapter.getDrizzle(),
    args.adapter.dialect,
    stored
  );
  const keepsLegacy = live.tables
    .filter(
      table =>
        holds(table, STORAGE_FORMAT.columns.type) &&
        !holds(table, MIGRATION_TARGET.columnType)
    )
    .map(table => table.name);
  if (keepsLegacy.length === 0) return;
  const read = await underDatabaseFieldGroupNames(args.adapter, args.snapshots);
  const unrecorded = keepsLegacy.filter(name =>
    read.some(({ snapshot }) =>
      snapshot.tables.some(
        table =>
          table.name === name &&
          holds(table, MIGRATION_TARGET.columnType) &&
          !holds(table, STORAGE_FORMAT.columns.type)
      )
    )
  );
  if (unrecorded.length > 0) {
    throw fieldGroupTypeColumnNotRecordedError(unrecorded);
  }
}

/** Whether `table` has a column named `column`. */
function holds(
  table: { columns: readonly { name: string }[] },
  column: string
): boolean {
  return table.columns.some(held => held.name === column);
}

/** The refusal of field-group tables whose legacy type column the history does not record. */
export function fieldGroupTypeColumnNotRecordedError(
  tables: readonly string[]
): NextlyError {
  const list = tables.join(", ");
  const one = tables.length === 1;
  return new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      `This database's field-group ${one ? "table" : "tables"} ${list} still ${one ? "holds" : "hold"} the legacy type column ${STORAGE_FORMAT.columns.type}, and the project's migration history records ${MIGRATION_TARGET.columnType} there. ` +
      `An earlier release created ${one ? "it" : "them"} after the field groups moved to the current names, so the storage migration never renamed the column, and every file planned from the history would address a column the database does not have. ` +
      "No file was applied. Re-baseline the history with `nextly migrate:baseline`: it lists how to clear the existing migrations, then records each table with the columns it holds.",
    logContext: {
      reason: "field-group-type-column-not-recorded",
      tables: [...tables],
    },
  });
}
