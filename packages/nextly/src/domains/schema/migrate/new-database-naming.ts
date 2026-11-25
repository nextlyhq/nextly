/**
 * The field-group names an empty database of a project starts on: the one decision of it, for
 * every path that sets one up (a development start, `nextly db:sync`, `nextly migrate` and the
 * migrations at start) and for the compile each of them makes first.
 *
 * The project's migration history decides, by the names it begins on: those its first file makes
 * the storage under. Set up on other names, the database's storage is not the one its history
 * describes, and neither a Schema Builder save nor `nextly migrate` could go on from it. A history
 * that moved to the current names part-way begins on the legacy ones, so its empty database does,
 * and goes through the move as every other database of the project did. A project with no history
 * yet starts on the current names, as its first migration records them.
 *
 * Only an empty database asks. Every other keeps the names it holds, whatever the folder says.
 *
 * @module domains/schema/migrate/new-database-naming
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { NextlyError } from "../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { MIGRATION_TARGET } from "../../field-groups/migration/target";
import type { FieldGroupNaming } from "../../field-groups/services/field-group-storage-names";
import {
  historyFieldGroupNamingIn,
  recordedSnapshotNames,
  snapshotFileNaming,
  SnapshotFileError,
} from "../migrate-create/snapshot-io";

/** The migration ledger, which every database a start or `nextly migrate` set up holds. */
const LEDGER_TABLE = "nextly_schema_events";

/** The field-group registry, under each of its names. */
const REGISTRY_TABLES = [
  STORAGE_FORMAT.registryTable,
  MIGRATION_TARGET.registryTable,
] as const;

/** The reason of the refusal where the history cannot be read. */
const UNREADABLE = "new-database-history-unreadable";

/**
 * The names an empty database of the project with `migrationsDir` starts on. A history whose
 * names cannot be told is refused, and so is one whose newest snapshot cannot be read: taken as no
 * history, the database would be set up on names the history may not be on.
 */
export async function emptyDatabaseFieldGroupNaming(
  migrationsDir: string
): Promise<FieldGroupNaming> {
  const metaDir = resolve(migrationsDir, "meta");
  const [first] = await recordedSnapshotNames(metaDir);
  if (first === undefined) return "current";
  try {
    // The newest too: a history every later command refuses is refused before it is begun on.
    if ((await historyFieldGroupNamingIn(metaDir)) === "legacy") {
      return "legacy";
    }
    return snapshotFileNaming(
      await readFile(resolve(metaDir, first), "utf-8"),
      first
    );
  } catch (error) {
    if (!(error instanceof SnapshotFileError)) throw error;
    throw newDatabaseHistoryUnreadable(error);
  }
}

/**
 * {@link emptyDatabaseFieldGroupNaming} of `adapter`'s database, or undefined where it has been
 * set up. "Empty" is the probe a first start makes (`ensureFirstRunSetup`): the migration ledger
 * is absent, which `nextly migrate` creates only after the core schema. And it holds no registry
 * under either name, asked table by table: a site from before the ledger has one, and a second
 * registry beside a live one would hide every group. Never decided from the registry alone, since
 * a catalog listing filtered by privileges reads as holding none.
 */
export async function newDatabaseFieldGroupNaming(args: {
  adapter: unknown;
  migrationsDir: string;
}): Promise<FieldGroupNaming | undefined> {
  if (!(await databaseIsEmpty(args.adapter))) return undefined;
  return emptyDatabaseFieldGroupNaming(args.migrationsDir);
}

/** Whether `adapter`'s database is one nothing has set up; false where it cannot be asked. */
export async function databaseIsEmpty(adapter: unknown): Promise<boolean> {
  const probe = adapter as {
    tableExists?: (table: string) => Promise<boolean>;
  };
  if (typeof probe.tableExists !== "function") return false;
  for (const table of [LEDGER_TABLE, ...REGISTRY_TABLES]) {
    if (await probe.tableExists(table)) return false;
  }
  return true;
}

/** Whether `error` is the refusal of a history that cannot be read. */
export function isNewDatabaseHistoryUnreadable(error: unknown): boolean {
  return (
    error instanceof NextlyError && error.logContext?.reason === UNREADABLE
  );
}

/** The refusal to set a database up where its history's newest snapshot cannot be read. */
function newDatabaseHistoryUnreadable(cause: SnapshotFileError): NextlyError {
  return new NextlyError({
    code: "VALIDATION_ERROR",
    publicMessage:
      `This database has not been set up, and the project's migration history cannot be read: ${cause.message.replace(/\.$/, "")}. ` +
      "The field groups of a new database start on the names its history keeps them under, so nothing was set up. " +
      "Restore the file from version control; if a newer version of Nextly wrote it, upgrade `nextly` to that version.",
    logContext: { reason: UNREADABLE },
    cause,
  });
}
