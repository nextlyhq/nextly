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
} from "../migrate-create/field-group-names-transition";
import {
  loadLatestSnapshot,
  snapshotFieldGroupNaming,
  type SnapshotFile,
} from "../migrate-create/snapshot-io";

/** The names the database keeps its field groups under, read from its registry in the catalog. */
export async function databaseFieldGroupNaming(
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
  throw new NextlyError({
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
  const latest = await loadLatestSnapshot(resolve(args.migrationsDir, "meta"));
  if (latest !== null && snapshotFieldGroupNaming(latest.data) === "current") {
    return;
  }
  throw new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      "This database's field groups were moved to the current names (dynamic_field_groups, fg_<slug>), and the project's migration history is still on the legacy ones (dynamic_components, comp_<slug>). " +
      "Every file after this point would be planned against tables the database no longer has. " +
      `No file was applied. Run \`${FIELD_GROUP_TRANSITION_COMMAND}\`, then \`nextly migrate\` again.`,
    logContext: { reason: "field-group-history-behind-storage" },
  });
}
