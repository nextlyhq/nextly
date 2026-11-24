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
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import {
  firstIdentifierNamed,
  missingSchemaObject,
  statementTableOf,
  tableOfMissingColumn,
} from "../../../database/missing-column";
import { getSchemaRegistryFromDI } from "../../../dispatcher/helpers/di";
import { NextlyError } from "../../../errors/nextly-error";
import type { DynamicFieldGroupRecord } from "../../../schemas/dynamic-field-groups/types";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import { introspectLiveColumns } from "../../schema/pipeline/diff/introspect-live";
import { resolveComponentTableName } from "../../schema/utils/resolve-table-name";
import { registerComponentRuntimeSchema } from "../services/field-group-table-provisioning";
import {
  forgetFieldGroupStorageNames,
  resolveFieldGroupRegistryTable,
  resolveTableColumns,
  type CatalogReadAdapter,
} from "../storage/resolve-storage-names";

import { MIGRATION_TARGET, retargetName } from "./manifest";

/**
 * Storage the migration may have moved, as the database named it missing: a table or a
 * discriminator column, and the name the migration's other generation gives it.
 */
type MoveCandidate = {
  /** `unregistered`: a name this process has not registered, refused before any statement ran. */
  kind: "table" | "column" | "unregistered";
  missing: string;
  other: string;
  /** The table a missing column belongs to, where the error says. */
  table?: string;
};

/** The two generations of every name the migration gives, in both directions. */
const TABLE_PREFIXES = [
  [STORAGE_FORMAT.tablePrefix, MIGRATION_TARGET.tablePrefix],
  [MIGRATION_TARGET.tablePrefix, STORAGE_FORMAT.tablePrefix],
] as const;
const REGISTRY_TABLES = [
  STORAGE_FORMAT.registryTable,
  MIGRATION_TARGET.registryTable,
] as const;
const TYPE_COLUMNS = [
  STORAGE_FORMAT.columns.type,
  MIGRATION_TARGET.columnType,
] as const;

/** The name the other generation gives `table`, or undefined for a name of neither. */
function otherTableName(table: string): string | undefined {
  if (table === REGISTRY_TABLES[0]) return REGISTRY_TABLES[1];
  if (table === REGISTRY_TABLES[1]) return REGISTRY_TABLES[0];
  for (const [from, to] of TABLE_PREFIXES) {
    if (table.startsWith(from)) return `${to}${table.slice(from.length)}`;
  }
  return undefined;
}

/** A field-group table or registry name standing as an identifier in a driver's message. */
const FIELD_GROUP_TABLE = new RegExp(
  `(?:^|['"\\x60.\\s:])((?:${TABLE_PREFIXES.map(([from]) => from).join("|")})[\\w$-]+|${REGISTRY_TABLES.join("|")})(?![\\w$.-])`
);

/**
 * What `error` says is missing that the migration could have moved, or undefined. Read by the one
 * classifier of missing schema objects (`missingSchemaObject`), past any NextlyError: one raised
 * as a refusal has decided its answer, and only the database error it carries says what is
 * missing. A column counts only when it is the discriminator, the one column the migration renames:
 * any other is the project's own, missing because its migration has not run.
 */
function moveCandidate(error: unknown): MoveCandidate | undefined {
  let cause: unknown = error;
  for (let depth = 0; NextlyError.is(cause) && depth < 8; depth += 1) {
    cause = (cause as { cause?: unknown }).cause;
  }
  const found = missingSchemaObject(cause);
  if (found?.object === "table" || found?.object === "unregistered") {
    const missing = FIELD_GROUP_TABLE.exec(found.text)?.[1];
    const other = missing === undefined ? undefined : otherTableName(missing);
    return missing === undefined || other === undefined
      ? undefined
      : { kind: found.object, missing, other };
  }
  if (found?.object !== "column") return undefined;
  const missing = firstIdentifierNamed(found.text, TYPE_COLUMNS);
  if (missing === undefined) return undefined;
  const table =
    tableOfMissingColumn(found.text, missing) ?? statementTableOf(cause);
  return {
    kind: "column",
    missing,
    other: missing === TYPE_COLUMNS[0] ? TYPE_COLUMNS[1] : TYPE_COLUMNS[0],
    ...(table === undefined ? {} : { table }),
  };
}

/** A field group's own table as this process registered it, with the discriminator it addresses. */
interface RegisteredTable {
  name: string;
  typeColumn: string;
}

/**
 * The field groups' tables this process has registered, or undefined when it cannot say. Read from
 * the registry each time rather than remembered, so nothing that registers a table (a start, a
 * development reload, a schema-version change, a follow) has to remember to say so.
 */
function registeredTables(
  adapter: DrizzleAdapter
): RegisteredTable[] | undefined {
  const registry = (getSchemaRegistryFromDI() ??
    (adapter as unknown as { tableResolver?: unknown }).tableResolver) as
    | {
        getDynamicTableNames?: () => string[];
        getTable?: (name: string) => unknown;
      }
    | null
    | undefined;
  if (
    typeof registry?.getDynamicTableNames !== "function" ||
    typeof registry.getTable !== "function"
  ) {
    return undefined;
  }
  const tables: RegisteredTable[] = [];
  for (const name of registry.getDynamicTableNames()) {
    const table = registry.getTable(name) as
      | Record<string, { name?: unknown } | undefined>
      | null
      | undefined;
    // A field group's own table alone carries the discriminator, under this key in every generation.
    const typeColumn = table?.[STORAGE_FORMAT.columns.type]?.name;
    if (typeof typeColumn === "string") tables.push({ name, typeColumn });
  }
  return tables;
}

/**
 * Whether this process addresses field-group storage under the current names only, so the
 * migration has nothing left to move under it: the registry it resolved is the current one, and so
 * is the discriminator of every field-group table it registered. The registry alone does not say
 * so: it is renamed last, and a process that resolved it again still holds the tables it registered
 * before. Anything it cannot tell answers false.
 */
async function isSettledOnCurrentNames(
  adapter: DrizzleAdapter
): Promise<boolean> {
  const tables = registeredTables(adapter);
  if (
    tables === undefined ||
    tables.some(table => table.typeColumn !== MIGRATION_TARGET.columnType)
  ) {
    return false;
  }
  try {
    return (await resolveFieldGroupRegistryTable(adapter)).migrated;
  } catch {
    return false;
  }
}

/**
 * Whether the database holds what `candidate` names under the migration's other generation: what
 * tells storage that moved from storage that was never created. A field group whose table or column
 * no migration has made yet is in neither place, and its failure stays the failure it was.
 */
async function heldElsewhere(
  adapter: DrizzleAdapter,
  candidate: MoveCandidate,
  catalog: CatalogReadAdapter
): Promise<boolean> {
  const registered = registeredTables(adapter) ?? [];
  // A name new to this process moved only when it is the other name of one it registered: any
  // other is a table made since it started, which it must be restarted to serve.
  if (
    candidate.kind === "unregistered" &&
    !registered.some(table => table.name === candidate.other)
  ) {
    return false;
  }
  const asked =
    candidate.kind === "table"
      ? [candidate.other]
      : candidate.kind === "unregistered"
        ? [candidate.missing]
        : (candidate.table === undefined
            ? registered.map(table => table.name)
            : [candidate.table]
          ).flatMap(table => [table, otherTableName(table) ?? table]);
  if (asked.length === 0) return false;
  const snapshot = await introspectLiveColumns(
    catalog.getDrizzle(),
    catalog.dialect,
    [...new Set(asked)]
  );
  return snapshot.tables.some(table => {
    if (candidate.kind !== "column") return table.columns.length > 0;
    const names = table.columns.map(column => column.name);
    return (
      names.includes(candidate.other) && !names.includes(candidate.missing)
    );
  });
}

/**
 * Whether a read that failed with `error` is worth following: storage the migration could have
 * moved, or a table this process has not registered, as a name the migration gave is until then.
 */
export function isMovedStorageError(error: unknown): boolean {
  return (
    moveCandidate(error) !== undefined ||
    missingSchemaObject(error)?.object === "unregistered"
  );
}

/** Whether `error`'s storage was moved by the migration, as the database holds it now. */
async function isMovedStorage(
  adapter: DrizzleAdapter,
  error: unknown,
  catalog: CatalogReadAdapter = adapter
): Promise<boolean> {
  const candidate = moveCandidate(error);
  if (candidate === undefined) return false;
  try {
    return await heldElsewhere(adapter, candidate, catalog);
  } catch {
    // A catalog that cannot be read says nothing: the caller's own error stands.
    return false;
  }
}

/**
 * Every field-group table this process may address under a moved name, followed
 * (`followMovedFieldGroupTable`): each it registered, and the one the database named.
 */
async function followEveryTable(
  adapter: DrizzleAdapter,
  rows: FieldGroupRows,
  error: unknown
): Promise<void> {
  const candidate = moveCandidate(error);
  const named =
    candidate?.kind === "column" ? candidate.table : candidate?.missing;
  const tables = new Set([
    ...(registeredTables(adapter) ?? []).map(table => table.name),
    // A companion is registered with the group's own table.
    ...(named === undefined ? [] : [named.replace(/_locales$/, "")]),
  ]);
  for (const tableName of tables) {
    await followMovedFieldGroupTable({ adapter, rows, tableName });
  }
}

/**
 * `registry`, its lookups following a registry the storage migration moved: a lookup that fails as
 * moved storage fails (`moveCandidate`) forgets what this process resolved about storage
 * names and runs once more, so it reads the registry under the name it holds now. The migration
 * renames the registry last, after the tables, so a name re-resolved between the two goes stale
 * again; this is where that is caught, whichever lookup meets it first.
 *
 * A lookup on a caller's transaction (an argument that is a database executor) is raised as it was:
 * the failure has aborted that transaction on PostgreSQL, and the write that owns it decides
 * (`refusingMovedStorage`).
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
          if (
            !isMovedStorageError(error) ||
            args.some(argument => isExecutor(argument))
          ) {
            throw error;
          }
          forgetFieldGroupStorageNames(adapter);
          clearRegistryRowCache();
          try {
            return await run();
          } catch {
            // The second failure says no more than the first, which is the one raised.
            throw error;
          }
        });
      };
    },
  });
}

/**
 * Whether `value` is a database executor, as a registry lookup on a caller's transaction is handed:
 * a Drizzle database or transaction, told by the `select` it is queried through.
 */
function isExecutor(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { select?: unknown }).select === "function"
  );
}

let savepointSequence = 0;

/**
 * Run `work`, which reads or writes field groups on the caller's transaction, refusing it to be
 * retried when it failed because the migration moved its storage, and raising its failure as it was
 * otherwise.
 *
 * Whether storage moved is read on the transaction's own connection, which a failed statement
 * leaves usable on SQLite and MySQL. PostgreSQL aborts the transaction, so `work` runs in a
 * savepoint there and the question is asked once it is rolled back; a process settled on the
 * current names (`isSettledOnCurrentNames`) has nothing to ask and takes none.
 *
 * The names are followed once the transaction has rolled back and its connection is free, so the
 * retry addresses storage as the database holds it.
 */
export async function refusingMovedStorage<T>(args: {
  adapter: DrizzleAdapter;
  rows: FieldGroupRows;
  tx: TransactionContext;
  work: () => Promise<T>;
}): Promise<T> {
  const { adapter, rows, tx, work } = args;
  const savepoint =
    adapter.dialect === "postgresql" &&
    !(await isSettledOnCurrentNames(adapter))
      ? `nextly_moved_storage_${++savepointSequence}`
      : undefined;
  if (savepoint !== undefined) await tx.savepoint?.(savepoint);
  try {
    const result = await work();
    if (savepoint !== undefined) await tx.releaseSavepoint?.(savepoint);
    return result;
  } catch (error) {
    const candidate = moveCandidate(error);
    if (candidate === undefined) throw error;
    if (savepoint !== undefined) {
      try {
        await tx.rollbackToSavepoint?.(savepoint);
        await tx.releaseSavepoint?.(savepoint);
      } catch {
        // The transaction is gone with its savepoint: nothing can be asked on it.
        throw error;
      }
    } else if (
      adapter.dialect === "postgresql" &&
      candidate.kind !== "unregistered"
    ) {
      // Nothing can be asked on the aborted transaction. Only a rollback of the migration moves
      // storage under a process settled on the current names: the names are followed, so a retry
      // finds them, and the failure is raised as it was.
      await adapter.afterRollback(() => followEveryTable(adapter, rows, error));
      throw error;
    }
    const catalog: CatalogReadAdapter = {
      dialect: adapter.dialect,
      getDrizzle: <H>() => tx.getDrizzle<H>(),
    };
    if (!(await isMovedStorage(adapter, error, catalog))) throw error;
    await adapter.afterRollback(() => followEveryTable(adapter, rows, error));
    throw storageMovingRefusal(candidate.missing);
  }
}

/**
 * Raise `error` when the migration moved the storage it names, for a caller that otherwise reads a
 * missing table as one holding nothing: read so, a save or a delete would leave behind what the
 * table holds under its other name. On PostgreSQL the failure has aborted the transaction, so the
 * statements after it cannot run either, and any missing field-group storage is raised.
 */
export async function raiseIfMoved(args: {
  adapter: DrizzleAdapter;
  error: unknown;
  /** The caller's transaction, when it runs on one. */
  executor?: unknown;
}): Promise<void> {
  const { adapter, error, executor } = args;
  const candidate = moveCandidate(error);
  if (candidate === undefined) return;
  if (executor === undefined) {
    if (await isMovedStorage(adapter, error)) throw error;
    return;
  }
  if (
    adapter.dialect === "postgresql" ||
    (await isMovedStorage(adapter, error, {
      dialect: adapter.dialect,
      getDrizzle: <H>() => executor as H,
    }))
  ) {
    throw error;
  }
}

/**
 * The refusal for a save off any transaction that failed because the migration moved its storage,
 * every table it may have met followed first; undefined when nothing moved.
 */
export async function refusalAfterFollowing(args: {
  adapter: DrizzleAdapter;
  rows: FieldGroupRows;
  error: unknown;
}): Promise<NextlyError | undefined> {
  const { adapter, rows, error } = args;
  const candidate = moveCandidate(error);
  if (candidate === undefined || !(await isMovedStorage(adapter, error))) {
    return undefined;
  }
  await followEveryTable(adapter, rows, error);
  return storageMovingRefusal(candidate.missing);
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
