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

import {
  firstIdentifierNamed,
  missingSchemaObject,
  statementTableOf,
  tableOfMissingColumn,
} from "../../../database/missing-column";
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
  resolveTableColumns,
  type CatalogReadAdapter,
} from "../storage/resolve-storage-names";

import { MIGRATION_TARGET, retargetName } from "./manifest";

/**
 * Storage the migration may have moved, as the database named it missing: a table or a
 * discriminator column, and the name the migration's other generation gives it.
 */
type MoveCandidate = {
  kind: "table" | "column";
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
  if (found?.object === "table") {
    const missing = FIELD_GROUP_TABLE.exec(found.text)?.[1];
    const other = missing === undefined ? undefined : otherTableName(missing);
    return missing === undefined || other === undefined
      ? undefined
      : { kind: "table", missing, other };
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

/**
 * Whether the database holds what `candidate` names missing under its other name: what tells
 * storage that moved from storage that was never created. A field group whose table or column no
 * migration has made yet is in neither place, and its failure stays the failure it was.
 */
async function heldUnderOtherName(
  candidate: MoveCandidate,
  catalog: CatalogReadAdapter,
  tables: readonly string[]
): Promise<boolean> {
  const asked =
    candidate.kind === "table"
      ? [candidate.other]
      : [candidate.table, ...tables].flatMap(table =>
          table === undefined ? [] : [table, otherTableName(table) ?? table]
        );
  if (asked.length === 0) return false;
  const snapshot = await introspectLiveColumns(
    catalog.getDrizzle(),
    catalog.dialect,
    [...new Set(asked)]
  );
  if (candidate.kind === "table") {
    return snapshot.tables.some(table => table.columns.length > 0);
  }
  return snapshot.tables.some(table => {
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
  catalog: CatalogReadAdapter,
  error: unknown,
  tables: readonly string[]
): Promise<boolean> {
  const candidate = moveCandidate(error);
  if (candidate === undefined) return false;
  try {
    return await heldUnderOtherName(candidate, catalog, tables);
  } catch {
    // A catalog that cannot be read says nothing: the caller's own error stands.
    return false;
  }
}

/** Every table a follow of `error` looks for: those named, and the one the database named. */
function tablesToFollow(error: unknown, tables: readonly string[]): string[] {
  const candidate = moveCandidate(error);
  const named =
    candidate?.kind === "table" ? candidate.missing : candidate?.table;
  return [
    ...new Set([
      ...tables,
      // A companion is registered with the group's own table.
      ...(named === undefined ? [] : [named.replace(/_locales$/, "")]),
    ]),
  ];
}

/**
 * `registry`, its lookups following a registry the storage migration moved: a lookup that fails as
 * moved storage fails (`moveCandidate`) forgets what this process resolved about storage
 * names and runs once more, so it reads the registry under the name it holds now. The migration
 * renames the registry last, after the tables, so a name re-resolved between the two goes stale
 * again; this is where that is caught, whichever lookup meets it first.
 *
 * A lookup on a caller's transaction (an argument that is a database executor) does not run again:
 * the failure has aborted that transaction on PostgreSQL. It is refused to be retried when the
 * registry moved (`refusalOnTransaction`), and raised as it was otherwise.
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
          if (moveCandidate(error) === undefined) throw error;
          const executor = args.find(isExecutor);
          if (executor !== undefined) {
            throw (
              (await refusalOnTransaction({
                adapter,
                executor,
                error,
                tableNames: [],
              })) ?? error
            );
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

/** How long a failed write on PostgreSQL waits to learn whether storage moved, in milliseconds. */
const POSTGRES_ANSWER_MS = 1000;

/**
 * The refusal for a statement on a caller's transaction that failed because the migration moved
 * its storage, or undefined when it did not move: the caller's own error then stands.
 *
 * SQLite and MySQL are asked on the transaction's own connection. PostgreSQL has aborted the
 * transaction, so it is asked on another, and for a bounded time only: where the pool has no other
 * connection the transaction holds it, and waiting for it would wait for ever. Unanswered, the
 * failure is raised as it was.
 *
 * The tables are followed without being awaited, so each follow runs once the caller has rolled
 * back and its connection is free, and the retry addresses storage under its current names.
 */
export async function refusalOnTransaction(args: {
  adapter: DrizzleAdapter;
  /** What the tables' registry rows are read through; absent when there are none to follow. */
  rows?: FieldGroupRows;
  executor: unknown;
  error: unknown;
  tableNames: readonly string[];
}): Promise<NextlyError | undefined> {
  const { adapter, rows, executor, error, tableNames } = args;
  if (moveCandidate(error) === undefined) return undefined;
  const moved =
    adapter.dialect === "postgresql"
      ? await withinMs(
          isMovedStorage(adapter, error, tableNames),
          POSTGRES_ANSWER_MS
        )
      : await isMovedStorage(
          { dialect: adapter.dialect, getDrizzle: <T>() => executor as T },
          error,
          tableNames
        );
  if (moved === false) return undefined;
  forgetFieldGroupStorageNames(adapter);
  clearRegistryRowCache();
  const follow = tablesToFollow(error, tableNames);
  if (rows !== undefined) {
    // Not awaited: a follow never rejects, and it may need the connection the caller still holds.
    void followMovedFieldGroupTables({ adapter, rows, tableNames: follow });
  }
  return moved === true
    ? storageMovingRefusal(follow.join(", ") || "the field-group registry")
    : undefined;
}

/** `work`'s answer, or undefined when it has not come within `ms`. */
async function withinMs<T>(
  work: Promise<T>,
  ms: number
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
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
  tableNames: readonly string[];
}): Promise<NextlyError | undefined> {
  const { adapter, rows, error, tableNames } = args;
  if (!(await isMovedStorage(adapter, error, tableNames))) return undefined;
  const follow = tablesToFollow(error, tableNames);
  await followMovedFieldGroupTables({ adapter, rows, tableNames: follow });
  return storageMovingRefusal(follow.join(", "));
}

/**
 * Each of `tableNames` followed (`followMovedFieldGroupTable`), every one of them rather than the
 * first that answers: a save names every field group it may write, and the one whose table failed
 * need not be the first. The names they are stored under now, for those that moved.
 */
async function followMovedFieldGroupTables(args: {
  adapter: DrizzleAdapter;
  rows: FieldGroupRows;
  tableNames: readonly string[];
}): Promise<string[]> {
  const moved: string[] = [];
  for (const tableName of new Set(args.tableNames)) {
    const current = await followMovedFieldGroupTable({ ...args, tableName });
    if (current !== undefined) moved.push(current);
  }
  return moved;
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
