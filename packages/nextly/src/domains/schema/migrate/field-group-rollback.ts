/**
 * Whether `nextly migrate:field-groups --down` may move a database's field groups back to the
 * legacy names.
 *
 * A project's migration history records the field-group names it is on, and every migration after a
 * point is planned against them. Once the history a database has applied is on the current names,
 * moving its storage back leaves the two in opposite directions, and no command moves a history
 * back: every later migration would address tables the database no longer has. So the move back is
 * refused, before the storage migration reads or changes anything, in a preview as in a real run.
 *
 * A move back undoes only what the recorded move holds. A group created on the current names, as
 * every group of a new site is, was never moved: its table would stay `fg_<slug>` beside a legacy
 * registry, and the storage could then move neither way. So the move back is refused for it too.
 *
 * A run that was stopped part-way is not judged here. The storage migration refuses the opposite
 * direction while one is in flight, so the only way to finish a stopped `--down` is `--down`.
 *
 * @module domains/schema/migrate/field-group-rollback
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import type { ManifestEntry } from "../../field-groups/migration/manifest";
import { readMigrationState } from "../../field-groups/migration/state";
import { CURRENT_NAMES_SHOWN } from "../../field-groups/services/field-group-names-shown";
import type { FieldGroupNaming } from "../../field-groups/services/field-group-storage-names";
import {
  fieldGroupRegistryUnreadable,
  readStoredFieldGroupTables,
} from "../../field-groups/services/field-group-stored-tables";
import { MetaService } from "../../meta/services/meta-service";
import { removedOnPurpose } from "../events/migration-state";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import {
  SnapshotFileError,
  snapshotFileNaming,
} from "../migrate-create/snapshot-io";
import { appliedAppMigrations } from "../schema-version";

import { compareMigrationRecency } from "./migration-order";
import { readOldBuilderLedger } from "./old-builder-ledger";

/** The marker is only read here, and a read that fails throws. */
const SILENT = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Refuses the move back where the history this database has applied is on the current names, where
 * which names it is on cannot be told, and where a field group was created on the current names.
 * Goes on while a run is in flight.
 */
export async function refuseRollbackUnderCurrentHistory(args: {
  adapter: DrizzleAdapter;
  /** Absolute path to the project's migrations folder. */
  migrationsDir: string;
}): Promise<void> {
  const { adapter, migrationsDir } = args;
  const state = await readMigrationState(new MetaService(adapter, SILENT));
  if (state.status === "migrating") return;
  await refuseUnderCurrentHistory(adapter, migrationsDir);
  if (state.appliedManifest !== undefined) {
    await refuseGroupsTheMoveDoesNotHold(adapter, state.appliedManifest);
  }
}

/** The refusal of a move back where the applied history is on the current names. */
async function refuseUnderCurrentHistory(
  adapter: DrizzleAdapter,
  migrationsDir: string
): Promise<void> {
  const { dialect } = adapter.getCapabilities();
  const applied = await appliedNewestFirst(adapter, migrationsDir, dialect);
  const { discoverMigrationGroups, selectVariant } = await import(
    "../../../cli/utils/migration-discovery"
  );
  const groups = applied.length
    ? await discoverMigrationGroups(migrationsDir, dialect)
    : new Map<string, never>();
  // The newest applied file that has a snapshot says which names the history is on. A hand-written
  // file has none, and says nothing.
  for (const name of applied) {
    const group = groups.get(name);
    if (group === undefined || !selectVariant(group.variants, dialect)) {
      throw rollbackHistoryUnreadableError(
        name,
        `its file is not in the migrations folder (${migrationsDir})`
      );
    }
    const naming = await snapshotNamingOf(migrationsDir, name);
    if (naming === null) continue;
    if (naming === "current") throw rollbackRefusedError(name);
    return;
  }
}

/**
 * The app migrations the ledger records applied, newest first, by base name. Left out are an old
 * Schema Builder file's rows, which are no history, and a file whose removal was recorded on
 * purpose (`migrate:resolve --removed`), which the folder will never hold again.
 */
async function appliedNewestFirst(
  adapter: DrizzleAdapter,
  migrationsDir: string,
  dialect: ReturnType<DrizzleAdapter["getCapabilities"]>["dialect"]
): Promise<string[]> {
  if (!(await adapter.tableExists("nextly_schema_events"))) return [];
  const repo = new SchemaEventsRepository(adapter.getDrizzle(), dialect);
  const rows = await repo.listFileApplies();
  if (rows.length === 0) return [];
  const { ignoredRows } = await readOldBuilderLedger(
    { migrationsDir, dialect },
    repo,
    rows
  );
  const history = rows.filter(
    row => row.filename === null || !ignoredRows.has(row.filename)
  );
  const removed = removedOnPurpose(history, await repo.listFileRemovals());
  return [...appliedAppMigrations(history)]
    .filter(name => !removed.has(`${name}.sql`))
    .sort((a, b) => compareMigrationRecency(b, a));
}

/**
 * The names the snapshot of `name` is on, or null where it has none. One that cannot be read is
 * refused, and so, by name, is one that says two.
 */
async function snapshotNamingOf(
  migrationsDir: string,
  name: string
): Promise<FieldGroupNaming | null> {
  const file = `${name}.snapshot.json`;
  let content: string;
  try {
    content = await readFile(resolve(migrationsDir, "meta", file), "utf-8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw rollbackHistoryUnreadableError(name, "its snapshot cannot be read");
  }
  try {
    return snapshotFileNaming(content, file);
  } catch (error) {
    if (!(error instanceof SnapshotFileError)) throw error;
    throw rollbackHistoryUnreadableError(name, "its snapshot cannot be read");
  }
}

/** Refuses the move back where a group's table is one the recorded move does not hold. */
async function refuseGroupsTheMoveDoesNotHold(
  adapter: DrizzleAdapter,
  moved: readonly ManifestEntry[]
): Promise<void> {
  // A group under a name its author chose kept its table, and is in the move by its type column.
  const held = new Set(
    moved.flatMap(entry =>
      [entry.to, entry.table].map(name => name?.toLowerCase())
    )
  );
  const stored = await readStoredFieldGroupTables(adapter);
  if (!stored.usable) throw fieldGroupRegistryUnreadable(stored.reason);
  const created = [...stored.tables]
    .filter(([, table]) => !held.has(table.toLowerCase()))
    .map(([slug]) => slug)
    .sort();
  if (created.length > 0) throw rollbackGroupsNotMovedError(created);
}

/** The refusal of a move back where a group was created on the current names. */
export function rollbackGroupsNotMovedError(
  slugs: readonly string[]
): NextlyError {
  const one = slugs.length === 1;
  return new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      `This database's field groups cannot be moved back to the legacy names: ${slugs.join(", ")} ${one ? "was" : "were"} created on the current ones (fg_<slug>), so there is no move of ${one ? "it" : "them"} to undo. ` +
      `Only the registry and the groups a move took would go back, and the storage could then move neither way. ` +
      "Nothing was changed. The field-group storage stays on the current names.",
    logContext: {
      reason: "field-group-rollback-groups-not-moved",
      fieldGroups: [...slugs],
    },
  });
}

/** The refusal of a move back under a history on the current names. */
export function rollbackRefusedError(newest: string): NextlyError {
  return new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      `This database's field groups cannot be moved back to the legacy names: its applied migration history is on the current ones (${CURRENT_NAMES_SHOWN}), as ${newest} records. ` +
      "Every migration after it is planned against those names, and no command moves a history back. " +
      "Nothing was changed. The field-group storage stays on the current names while this history is applied.",
    logContext: {
      reason: "field-group-rollback-under-current-history",
      migration: newest,
    },
  });
}

/** The refusal of a move back where the applied history's names cannot be told. */
export function rollbackHistoryUnreadableError(
  name: string,
  problem: string
): NextlyError {
  return new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      `Whether this database's field groups can be moved back could not be told: ${name} is recorded applied, and ${problem}. ` +
      "A history on the current field-group names cannot be moved back, and only the project's migrations say which names it is on. " +
      "Nothing was changed. Run the command from the project that holds its migrations.",
    logContext: {
      reason: "field-group-rollback-history-unreadable",
      migration: name,
      problem,
    },
  });
}
