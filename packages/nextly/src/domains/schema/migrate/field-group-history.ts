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
import { MIGRATION_TARGET } from "../../field-groups/migration/target";
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
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

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
 * The legacy names of the field-group tables a moved registry holds: `comp_<rest>` for each
 * `fg_<rest>` it names, the rename the storage migration made. A table under a name of its own
 * was never renamed, so it is not one of them.
 */
function movedGroupTables(
  stored: ReadonlyMap<string, string>
): ReadonlySet<string> {
  return new Set(
    [...stored.values()]
      .filter(table => table.startsWith(MIGRATION_TARGET.tablePrefix))
      .map(
        table =>
          STORAGE_FORMAT.tablePrefix +
          table.slice(MIGRATION_TARGET.tablePrefix.length)
      )
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
  before: Pick<SnapshotFile, "fieldGroupStorage"> | null,
  target: Pick<SnapshotFile, "fieldGroupStorage"> | null
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
  filename: string
): Promise<void> {
  if ((await databaseFieldGroupNaming(adapter)) === "current") return;
  throw fieldGroupStorageNotMigratedError(filename);
}

/** The refusal of the transition file on a database whose field groups have not moved. */
export function fieldGroupStorageNotMigratedError(
  filename: string
): NextlyError {
  return new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      `${filename} moves the migration history to the current field-group names (dynamic_field_groups, fg_<slug>), and this database's field groups are still on the legacy ones (dynamic_components, comp_<slug>). ` +
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
      "This database's field groups were moved to the current names (dynamic_field_groups, fg_<slug>), and the project's migration history is still on the legacy ones (dynamic_components, comp_<slug>). " +
      "Every file after this point would be planned against tables the database no longer has. " +
      `No file was applied. Run \`${FIELD_GROUP_TRANSITION_COMMAND}\`, then \`nextly migrate\` again.`,
    logContext: { reason: "field-group-history-behind-storage" },
  });
}
