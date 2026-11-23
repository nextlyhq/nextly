/**
 * A running server meeting field-group storage that the storage migration moved under it.
 *
 * A server keeps what it resolved about storage for its whole life: the registry's name, the rows
 * it read from it, and the runtime table it registered for each field group. A
 * `migrate:field-groups --apply` run in another process renames those tables, and nothing tells
 * this process. Its next read of a field group then addresses a table that is gone.
 *
 * This is where it finds the name the table moved to. It forgets what this process resolved, reads
 * the registry again past its cache, and registers the field group's runtime table under the name
 * the database holds now. A read then retries once under that name. A save is refused with
 * {@link storageMovingRefusal} instead of retried: it may have written part of itself, and the
 * caller retries the whole save, which this process now addresses under the current names.
 *
 * @module domains/field-groups/migration/moved-storage
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import type { DynamicFieldGroupRecord } from "../../../schemas/dynamic-field-groups/types";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import { resolveComponentTableName } from "../../schema/utils/resolve-table-name";
import { registerComponentRuntimeSchema } from "../services/field-group-table-provisioning";
import {
  forgetFieldGroupStorageNames,
  resolveTableColumns,
} from "../storage/resolve-storage-names";

import { retargetName } from "./manifest";

/** The text of `error` and of its cause, where the driver's own message usually is. */
function errorText(error: unknown): string {
  return [
    error instanceof Error ? error.message : String(error),
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "",
  ].join(" ");
}

/** Whether `error` is the database saying a table is missing. */
export function isMissingTableError(error: unknown): boolean {
  const message = errorText(error);
  return (
    message.includes("no such table") ||
    message.includes("doesn't exist") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
}

/**
 * Whether `error` says a table is missing from the database, or unknown to this process's schema
 * registry: what a read meets once storage moved, by the old name or by a new one this process has
 * not registered yet.
 */
export function isMissingOrUnregisteredTableError(error: unknown): boolean {
  return (
    isMissingTableError(error) ||
    errorText(error).includes("not found in schema registry")
  );
}

/** What a field group's registry rows are read through: this process's registry service. */
export interface FieldGroupRows {
  getAllComponents(): Promise<DynamicFieldGroupRecord[]>;
}

/**
 * The name the field-group table `tableName` has moved to, registered in this process, or
 * `undefined` when it has not moved: no field group stores under `tableName`'s legacy name, or the
 * table the migration names in its place is not in the database (yet).
 *
 * Called after a statement on `tableName` failed because the table is missing. It never creates a
 * table and never writes: it only re-reads names and registers what the database holds.
 */
export async function followMovedFieldGroupTable(args: {
  adapter: DrizzleAdapter;
  rows: FieldGroupRows;
  tableName: string;
}): Promise<string | undefined> {
  // Best effort: a follow that cannot read the registry or the catalog leaves the caller's own
  // error to stand, rather than replacing it with one about the follow.
  try {
    return await follow(args);
  } catch {
    return undefined;
  }
}

async function follow(args: {
  adapter: DrizzleAdapter;
  rows: FieldGroupRows;
  tableName: string;
}): Promise<string | undefined> {
  const { adapter, rows, tableName } = args;
  // What this process resolved before the move is what sent it to a missing table.
  forgetFieldGroupStorageNames(adapter);
  clearRegistryRowCache();

  const groups = await rows.getAllComponents();
  const group = groups.find(
    row =>
      row.tableName === tableName ||
      resolveComponentTableName(row.slug) === tableName
  );
  if (group === undefined) return undefined;

  // The registry's own record of the move, else the name the migration renames this table to:
  // on MySQL a table can be renamed a moment before its registry row is rewritten.
  const candidates = [
    group.tableName,
    retargetName({ slug: group.slug, tableName }),
  ].filter(
    (name): name is string =>
      typeof name === "string" && name.length > 0 && name !== tableName
  );
  for (const current of candidates) {
    if (!(await adapter.tableExists(current))) continue;
    const held = (await resolveTableColumns(adapter, [current])).get(current);
    if (held === undefined) continue;
    const registered = registerComponentRuntimeSchema(
      adapter,
      adapter.getCapabilities().dialect,
      current,
      group.fields ?? [],
      held.typeColumn,
      storesPerLanguage(group),
      held.columns
    );
    return registered.registered ? current : undefined;
  }
  return undefined;
}

/** The code a save refused while field-group storage moves under it carries. */
export const FIELD_GROUP_STORAGE_MOVING = "FIELD_GROUP_STORAGE_MOVING";

/**
 * The refusal for a save that met field-group storage moving under it. The process has already
 * re-resolved the names (`followMovedFieldGroupTable`), so the same save succeeds when retried; a
 * save that met the migration between two of its steps succeeds once the run ends.
 */
export function storageMovingRefusal(tableName: string): NextlyError {
  return new NextlyError({
    code: "SERVICE_UNAVAILABLE",
    publicMessage:
      "The field-group storage migration is running or has just run. Retry the save once it ends.",
    publicData: {
      errors: [
        {
          // About the whole save rather than one of its fields; the table stays in the log.
          path: "",
          code: FIELD_GROUP_STORAGE_MOVING,
          message:
            "The field-group storage migration is running or has just run. Retry the save once it ends.",
        },
      ],
    },
    logMessage: `A save met field-group storage the migration moved: ${tableName}`,
    logContext: { reason: "field-group storage moved", tableName },
  });
}
