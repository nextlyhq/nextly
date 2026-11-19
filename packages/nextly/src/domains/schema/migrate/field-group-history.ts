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

import { resolve } from "node:path";

import { NextlyError } from "../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import {
  namingOfRegistry,
  type FieldGroupNaming,
} from "../../field-groups/services/field-group-storage-names";
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
  historyFieldGroupNamingIn,
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
>(adapter: CatalogReadAdapter, snapshots: readonly T[]): Promise<T[]> {
  if (!snapshots.some(entry => entry.fieldGroupNaming !== "current")) {
    return [...snapshots];
  }
  if ((await databaseFieldGroupNaming(adapter)) === "legacy") {
    return [...snapshots];
  }
  return snapshots.map(entry => {
    if (entry.fieldGroupNaming === "current") return entry;
    const groupTables = new Set(
      entry.snapshot.tables
        .map(table => table.name)
        .filter(name => name.startsWith(STORAGE_FORMAT.tablePrefix))
    );
    return {
      ...entry,
      snapshot: snapshotUnderCurrentNames(entry.snapshot, groupTables),
    };
  });
}

/** The names the database keeps its field groups under, read from its registry in the catalog. */
async function databaseFieldGroupNaming(
  adapter: CatalogReadAdapter
): Promise<FieldGroupNaming> {
  return namingOfRegistry(await resolveRegistryNameFromCatalog(adapter));
}

/**
 * Whether a migration moves the history from the legacy field-group names to the current ones:
 * its snapshot records `current` and the snapshot before it does not. A project whose first
 * snapshot is already on the current names has no transition.
 */
export function isFieldGroupTransition(
  before: Pick<SnapshotFile, "fieldGroupStorage"> | null,
  target: Pick<SnapshotFile, "fieldGroupStorage"> | null
): boolean {
  return (
    before !== null &&
    target !== null &&
    snapshotFieldGroupNaming(before) === "legacy" &&
    snapshotFieldGroupNaming(target) === "current"
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
 * up to its newest applied file, is still on the legacy ones and has no transition to come. Read
 * before the database is compared with that file, which would otherwise name every `comp_` table
 * as missing. A history whose newest file records the current names has the transition pending,
 * and applying it settles the two.
 */
export async function refuseMovedStorageBehindLegacyHistory(args: {
  adapter: CatalogReadAdapter;
  migrationsDir: string;
  newestApplied: FieldGroupNaming;
}): Promise<void> {
  if (args.newestApplied === "current") return;
  if ((await databaseFieldGroupNaming(args.adapter)) === "legacy") return;
  if (
    (await historyFieldGroupNamingIn(resolve(args.migrationsDir, "meta"))) ===
    "current"
  ) {
    return;
  }
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
