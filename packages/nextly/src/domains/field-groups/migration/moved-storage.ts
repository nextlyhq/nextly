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
  resolveRegistryTableName,
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
function isMissingTableError(error: unknown): boolean {
  const message = errorText(error);
  return (
    message.includes("no such table") ||
    message.includes("doesn't exist") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
}

/** Whether `error` is the database saying a column is missing. */
function isMissingColumnError(error: unknown): boolean {
  const message = errorText(error);
  return (
    message.includes("no such column") ||
    message.includes("Unknown column") ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

/**
 * Whether `error` is what a statement meets once the storage migration moved a field group's
 * storage: its table gone under the old name, its new name not yet registered in this process, or
 * its discriminator column renamed under a table this process registered before the rename.
 */
export function isMovedStorageError(error: unknown): boolean {
  return (
    isMissingTableError(error) ||
    isMissingColumnError(error) ||
    errorText(error).includes("not found in schema registry")
  );
}

/**
 * Whether `error`, or any error it was raised from, is the database saying a table or column is
 * missing. A NextlyError's own message is not read: one raised as a refusal has decided its answer,
 * and only the database errors it may carry say that storage moved.
 */
export function hasMovedStorageCause(error: unknown): boolean {
  for (
    let link: unknown = error, depth = 0;
    link !== undefined && link !== null && depth < 8;
    link = (link as { cause?: unknown }).cause, depth += 1
  ) {
    if (NextlyError.is(link)) continue;
    if (isMissingTableError(link) || isMissingColumnError(link)) return true;
  }
  return false;
}

/**
 * `registry`, its lookups following a registry the storage migration moved: a lookup that fails as
 * moved storage fails (`hasMovedStorageCause`) forgets what this process resolved about storage
 * names and runs once more, so it reads the registry under the name it holds now. The migration
 * renames the registry last, after the tables, so a name re-resolved between the two goes stale
 * again; this is where that is caught, whichever lookup meets it first.
 *
 * A lookup on a write's transaction cannot always run once more: the failure has aborted that
 * transaction on PostgreSQL, and the second try fails for that alone. Then the first failure
 * decides: the write is refused to be retried (`storageMovingRefusal`) when the registry's name
 * really did change under this process, and the first failure is raised as it was otherwise, never
 * the second, which says nothing about storage.
 */
export function followingMovedRegistry<T extends object>(
  registry: T,
  adapter: DrizzleAdapter
): T {
  return new Proxy(registry, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const run = (): unknown => Reflect.apply(value, target, args);
        const first = run();
        if (!(first instanceof Promise)) return first;
        return first.catch(async (error: unknown) => {
          if (!hasMovedStorageCause(error)) throw error;
          const before = await registryNameOf(adapter);
          forgetFieldGroupStorageNames(adapter);
          clearRegistryRowCache();
          try {
            return await run();
          } catch {
            const after = await registryNameOf(adapter);
            if (
              before !== undefined &&
              after !== undefined &&
              before !== after
            ) {
              throw storageMovingRefusal(after);
            }
            throw error;
          }
        });
      };
    },
  });
}

/** The registry's name as this process resolves it, or undefined where it cannot be read. */
async function registryNameOf(
  adapter: DrizzleAdapter
): Promise<string | undefined> {
  try {
    return await resolveRegistryTableName(adapter);
  } catch {
    return undefined;
  }
}

/**
 * Whether `error` is the refusal a write meeting moved storage is answered with: one a caller is
 * meant to see as it is, to retry the write, never wrapped into another error.
 */
export function isStorageMovingRefusal(error: unknown): boolean {
  if (!NextlyError.is(error)) return false;
  const data = error.publicData as
    | { errors?: readonly { code?: unknown }[] }
    | undefined;
  return (
    data?.errors?.some(issue => issue.code === FIELD_GROUP_STORAGE_MOVING) ===
    true
  );
}

/** What a field group's registry rows are read through: this process's registry service. */
export interface FieldGroupRows {
  getAllComponents(): Promise<DynamicFieldGroupRecord[]>;
}

/**
 * The name the field-group table `tableName` is stored under now, registered in this process with
 * the columns the database holds, or `undefined` when no field group stores there: the name it
 * moved to, or `tableName` itself where only its discriminator column moved.
 *
 * Called after a statement on `tableName` failed as moved storage fails (`isMovedStorageError`).
 * It never creates a table and never writes: it only re-reads names and registers what the
 * database holds. A caller retries once with the answer, never again, so a failure that is not a
 * move cannot loop.
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
  // Found by any name it has had: its registry row's, the legacy name its slug gives, or the name
  // the migration gives that, so a server following a rollback finds it as well as one following
  // the migration.
  const group = groups.find(row => {
    const legacy = resolveComponentTableName(row.slug);
    return (
      row.tableName === tableName ||
      legacy === tableName ||
      retargetName({ slug: row.slug, tableName: legacy }) === tableName
    );
  });
  if (group === undefined) return undefined;

  // The registry's own record of where it is now; else the name the migration renames it to, as
  // on MySQL a table can be renamed a moment before its registry row is rewritten; else its legacy
  // name, as after a rollback; and last `tableName` itself, where only its columns moved.
  const legacy = resolveComponentTableName(group.slug);
  const candidates = [
    ...new Set([
      group.tableName,
      retargetName({ slug: group.slug, tableName: legacy }),
      legacy,
      tableName,
    ]),
  ].filter(
    (name): name is string => typeof name === "string" && name.length > 0
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
const FIELD_GROUP_STORAGE_MOVING = "FIELD_GROUP_STORAGE_MOVING";

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
