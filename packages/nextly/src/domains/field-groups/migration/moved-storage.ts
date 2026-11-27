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
import { sql, type SQL } from "drizzle-orm";

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
import {
  clearRegistryRowCache,
  registryReadTransaction,
} from "../../dynamic-collections/services/collection-row-cache";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import { isCompanionReady } from "../../i18n/runtime/companion-readiness";
import { introspectLiveColumns } from "../../schema/pipeline/diff/introspect-live";
import { resolveComponentTableName } from "../../schema/utils/resolve-table-name";
import { registerComponentRuntimeSchema } from "../services/field-group-table-provisioning";
import {
  forgetFieldGroupStorageNames,
  resolveFieldGroupRegistryTable,
  resolveTableColumns,
  type CatalogReadAdapter,
  type FieldGroupRegistryName,
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
  const cause = beneathRefusals(error);
  const found = missingSchemaObject(cause);
  if (found === undefined) return undefined;
  return found.object === "column"
    ? movedColumn(found.text, cause)
    : movedTable(found.object, found.text);
}

/** The first error beneath any NextlyError `error` is or was raised from. */
function beneathRefusals(error: unknown): unknown {
  let cause: unknown = error;
  for (let depth = 0; NextlyError.is(cause) && depth < 8; depth += 1) {
    cause = (cause as { cause?: unknown }).cause;
  }
  return cause;
}

/** A missing table's candidate: a name of either generation, and what the other calls it. */
function movedTable(
  kind: "table" | "unregistered",
  text: string
): MoveCandidate | undefined {
  const missing = FIELD_GROUP_TABLE.exec(text)?.[1];
  const other = missing === undefined ? undefined : otherTableName(missing);
  return missing === undefined || other === undefined
    ? undefined
    : { kind, missing, other };
}

/** A missing column's candidate: the discriminator alone, and the table it is missing from. */
function movedColumn(text: string, cause: unknown): MoveCandidate | undefined {
  const missing = firstIdentifierNamed(text, TYPE_COLUMNS);
  if (missing === undefined) return undefined;
  const table = tableOfMissingColumn(text, missing) ?? statementTableOf(cause);
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
function isSettledOnCurrentNames(adapter: DrizzleAdapter): boolean {
  const tables = registeredTables(adapter);
  if (
    tables === undefined ||
    tables.some(table => table.typeColumn !== MIGRATION_TARGET.columnType)
  ) {
    return false;
  }
  return notedRegistryName(adapter) === MIGRATION_TARGET.registryTable;
}

/**
 * The name each database's registry was last found under by this process: resolved off any
 * transaction, or found on one that met a move. One place for it, which a lookup on a transaction
 * reads instead of resolving (on another connection), and a write reads to know whether it may
 * still meet a move.
 */
const registryNames = new WeakMap<DrizzleAdapter, FieldGroupRegistryName>();

/**
 * The names each process refused a failure on that it could not ask about (`unaskedFailure`),
 * forgotten when it follows a move.
 */
const unaskedRefusals = new WeakMap<DrizzleAdapter, Set<string>>();

/** Remember the name `adapter`'s registry was found under. */
export function noteRegistryName(
  adapter: DrizzleAdapter,
  name: FieldGroupRegistryName
): void {
  if (registryNames.get(adapter) !== name) unaskedRefusals.delete(adapter);
  registryNames.set(adapter, name);
}

/** The name `adapter`'s registry was last found under, or undefined before it was found. */
export function notedRegistryName(
  adapter: DrizzleAdapter
): FieldGroupRegistryName | undefined {
  return registryNames.get(adapter);
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

/** Whether a caller handed over a transaction's connection rather than nothing, or the pool. */
export function isOnTransaction(
  adapter: DrizzleAdapter,
  executor: unknown
): boolean {
  return onTransaction(adapter, executor) !== undefined;
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
  // Each follow forgot the registry's name to read it again; left forgotten by one that could not,
  // the next write would resolve it inside its transaction (`resolveAgain`).
  await resolveAgain(adapter);
}

/**
 * Forget the registry this process resolved, and resolve it again before anything needs it. Called
 * off any transaction, always: left to the next lookup, that one may run on a transaction, where
 * resolving reads the catalog on another connection, which a pool of one has not got.
 */
async function resolveAgain(adapter: DrizzleAdapter): Promise<void> {
  forgetFieldGroupStorageNames(adapter);
  clearRegistryRowCache();
  // A catalog that cannot be read is left to the next lookup to say so.
  await resolveFieldGroupRegistryTable(adapter).then(
    registry => noteRegistryName(adapter, registry.name),
    () => undefined
  );
}

/** Whether `candidate` is the field-group registry itself. */
function isRegistry(candidate: MoveCandidate | undefined): boolean {
  return (
    candidate?.kind === "table" &&
    REGISTRY_TABLES.some(name => name === candidate.missing)
  );
}

/**
 * A registry lookup, following a registry the storage migration moved: one that finds its table
 * gone looks up once more under the name the registry holds now. The migration renames the registry
 * last, after the tables, so a name re-resolved between the two goes stale again; this is where that
 * is caught, whichever caller meets it first.
 *
 * On a caller's transaction the registry's other name is read on that connection and the lookup run
 * again there (`noteRegistryName`), so nothing that asks is refused, or goes on without its answer, for
 * asking first. PostgreSQL can do so only while nothing of the transaction came after its savepoint
 * (`takeSavepoint`): a write that did is refused to be retried instead.
 */
export async function lookingUpRegistry<T>(args: {
  adapter: DrizzleAdapter;
  /** The caller's transaction, when the lookup runs on one. */
  executor: unknown;
  lookup: () => Promise<T>;
}): Promise<T> {
  const { adapter, lookup } = args;
  const executor = onTransaction(adapter, args.executor);
  if (executor === undefined) return lookingUpOffTransaction(adapter, lookup);

  const savepoint = await takeSavepoint(adapter, executor);
  const settled = isSettledOnCurrentNames(adapter);
  try {
    return await lookup();
  } catch (error) {
    const candidate = moveCandidate(error);
    if (candidate === undefined || !isRegistry(candidate)) throw error;
    if (!(await canAsk(adapter, executor, savepoint))) {
      await adapter.afterRollback(() => resolveAgain(adapter));
      throw unaskedFailure(adapter, error, candidate, savepoint, settled);
    }
    const moved = await isMovedStorage(
      adapter,
      error,
      catalogOn(adapter, executor)
    );
    if (moved && losesNothingByLookingAgain(adapter, savepoint)) {
      const other = REGISTRY_TABLES.find(name => name === candidate.other);
      if (other !== undefined) noteRegistryName(adapter, other);
      return lookup();
    }
    await leaveAborted(adapter, executor);
    if (!moved) throw error;
    await adapter.afterRollback(() => resolveAgain(adapter));
    throw storageMovingRefusal(candidate.missing);
  }
}

/** `lookingUpRegistry` with no transaction of the caller's: resolved again, and looked up once more. */
async function lookingUpOffTransaction<T>(
  adapter: DrizzleAdapter,
  lookup: () => Promise<T>
): Promise<T> {
  try {
    return await lookup();
  } catch (error) {
    const candidate = moveCandidate(error);
    if (!isRegistry(candidate)) throw error;
    if (adapter.transactionOpenInFlow()) {
      return lookingUpUnderOtherName(adapter, candidate, error, lookup);
    }
    await resolveAgain(adapter);
    // A second failure says no more than the first, which is the one raised.
    return lookup().catch(() => {
      throw error;
    });
  }
}

/**
 * A lookup made on the pool inside someone's transaction, made again under the registry's other
 * name. Nothing is read to find that name, as resolving it would be on another connection; a name
 * that is not there either leaves the one it had, and the failure it met, as they were.
 */
async function lookingUpUnderOtherName<T>(
  adapter: DrizzleAdapter,
  candidate: MoveCandidate | undefined,
  error: unknown,
  lookup: () => Promise<T>
): Promise<T> {
  const had = notedRegistryName(adapter);
  const other = REGISTRY_TABLES.find(name => name === candidate?.other);
  if (other === undefined) throw error;
  noteRegistryName(adapter, other);
  try {
    return await lookup();
  } catch {
    if (had !== undefined) noteRegistryName(adapter, had);
    throw error;
  }
}

/**
 * Whether a lookup can be made again on a transaction once its failure was asked about: always
 * where the failure left the transaction usable, and on PostgreSQL only while nothing of it came
 * after the savepoint it was rolled back to.
 */
function losesNothingByLookingAgain(
  adapter: DrizzleAdapter,
  savepoint: TransactionSavepoint | undefined
): boolean {
  return adapter.dialect !== "postgresql" || savepoint?.taken === true;
}

/**
 * The transaction's connection a caller handed over, or undefined when what it handed over is the
 * pool: a read with no transaction open can follow a move and go on, as one given no executor can.
 */
function onTransaction(adapter: DrizzleAdapter, executor: unknown): unknown {
  return executor !== undefined && adapter.transactionOpenInFlow()
    ? executor
    : undefined;
}

/** The catalog as `executor`, the connection a transaction holds, reads it. */
function catalogOn(
  adapter: DrizzleAdapter,
  executor: unknown
): CatalogReadAdapter {
  return { dialect: adapter.dialect, getDrizzle: <H>() => executor as H };
}

/** A PostgreSQL transaction's savepoint: its name, and whether this call took it. */
interface TransactionSavepoint {
  name: string;
  taken: boolean;
}

/**
 * Each transaction's one savepoint, with whether the part that took it has been rolled back since.
 */
const savepoints = new WeakMap<
  object,
  { name: string; undone: () => boolean }
>();

/** One statement on a transaction's connection, whichever handle of it the caller holds. */
async function runOn(executor: unknown, statement: SQL): Promise<void> {
  await (executor as { execute(query: SQL): Promise<unknown> }).execute(
    statement
  );
}

/**
 * The savepoint the first field-group statement of a PostgreSQL transaction takes, so that one
 * which fails can be asked about: a failed statement leaves the transaction answering nothing until
 * it is rolled back to it. One for the whole transaction, never released: what a transaction has
 * read it holds against a rename until it ends, so what can still fail is asked about the same way.
 *
 * Undefined where there is nothing to ask: on SQLite and MySQL, whose transactions a failed
 * statement leaves usable, and in a process settled on the current names.
 */
async function takeSavepoint(
  adapter: DrizzleAdapter,
  executor: unknown
): Promise<TransactionSavepoint | undefined> {
  if (adapter.dialect !== "postgresql") return undefined;
  const transaction = registryReadTransaction(adapter, executor);
  if (transaction === undefined) return undefined;
  const held = savepoints.get(transaction.transaction);
  if (held !== undefined && !held.undone()) {
    return { name: held.name, taken: false };
  }
  if (isSettledOnCurrentNames(adapter)) return undefined;
  const name = `nextly_moved_storage_${++savepointSequence}`;
  await runOn(executor, sql`SAVEPOINT ${sql.identifier(name)}`);
  savepoints.set(transaction.transaction, {
    name,
    undone: () => transaction.undone(),
  });
  return { name, taken: true };
}

/**
 * What a failure on a PostgreSQL transaction that cannot be asked about is raised as. A process
 * settled on the current names takes no savepoint, and only a rollback of the migration moves
 * field-group storage under it: refused to be retried, as a save that met the migration going up
 * is. Any other failure that cannot be asked about is raised as it was.
 */
function unaskedFailure(
  adapter: DrizzleAdapter,
  error: unknown,
  candidate: MoveCandidate,
  savepoint: TransactionSavepoint | undefined,
  settled: boolean
): unknown {
  if (savepoint !== undefined || !settled) return error;
  // Once for each name until a move is followed: a table gone for another reason has no other name
  // to follow, and its next failure is the database's own.
  const refused = unaskedRefusals.get(adapter) ?? new Set<string>();
  if (refused.has(candidate.missing)) return error;
  refused.add(candidate.missing);
  unaskedRefusals.set(adapter, refused);
  return storageMovingRefusal(candidate.missing);
}

/** Whether a transaction can be asked anything after a statement failed on it. */
async function canAsk(
  adapter: DrizzleAdapter,
  executor: unknown,
  savepoint: TransactionSavepoint | undefined
): Promise<boolean> {
  if (adapter.dialect !== "postgresql") return true;
  if (savepoint === undefined) return false;
  try {
    await runOn(
      executor,
      sql`ROLLBACK TO SAVEPOINT ${sql.identifier(savepoint.name)}`
    );
    return true;
  } catch {
    // Gone with a part of the transaction that was rolled back: nothing can be asked.
    return false;
  }
}

/**
 * Leave a PostgreSQL transaction aborted, as the failure left it, once it has been asked: rolled
 * back to the savepoint it has lost what it wrote since, and a caller that went on past the failure
 * would commit the rest.
 */
async function leaveAborted(
  adapter: DrizzleAdapter,
  executor: unknown
): Promise<void> {
  if (adapter.dialect !== "postgresql") return;
  await runOn(executor, sql`SELECT 1 / 0`).catch(() => undefined);
}

let savepointSequence = 0;

/**
 * Run `work`, which reads or writes field groups on the caller's transaction, refusing it to be
 * retried when it failed because the migration moved its storage, and raising its failure as it was
 * otherwise.
 *
 * Whether storage moved is read on the transaction's own connection. A failed statement leaves it
 * usable on SQLite and MySQL; on PostgreSQL it is rolled back to the transaction's savepoint first
 * (`takeSavepoint`), and left aborted again once it has answered.
 *
 * The names are followed once the transaction has rolled back and its connection is free, so the
 * retry addresses storage as the database holds it.
 */
export async function refusingMovedStorage<T>(args: {
  adapter: DrizzleAdapter;
  rows: FieldGroupRows;
  /** The caller's transaction; `work` runs plainly for a caller that has none. */
  executor: unknown;
  work: () => Promise<T>;
}): Promise<T> {
  const { adapter, rows, work } = args;
  const executor = onTransaction(adapter, args.executor);
  if (executor === undefined) return work();
  const savepoint = await takeSavepoint(adapter, executor);
  const settled = isSettledOnCurrentNames(adapter);
  try {
    return await work();
  } catch (error) {
    const candidate = moveCandidate(error);
    if (candidate === undefined) throw error;
    const follow = (): Promise<void> => followEveryTable(adapter, rows, error);
    // A name not registered is refused before any statement runs, so the transaction still answers.
    const ran = candidate.kind !== "unregistered";
    if (ran && !(await canAsk(adapter, executor, savepoint))) {
      // They are followed once the transaction has rolled back, so a retry finds them.
      await adapter.afterRollback(follow);
      throw unaskedFailure(adapter, error, candidate, savepoint, settled);
    }
    const moved = await isMovedStorage(
      adapter,
      error,
      catalogOn(adapter, executor)
    );
    if (ran) await leaveAborted(adapter, executor);
    if (!moved) throw error;
    await adapter.afterRollback(follow);
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
  const { adapter, error } = args;
  const executor = onTransaction(adapter, args.executor);
  const candidate = moveCandidate(error);
  if (candidate === undefined) return;
  if (executor === undefined) {
    if (await isMovedStorage(adapter, error)) throw error;
    return;
  }
  if (
    adapter.dialect === "postgresql" ||
    (await isMovedStorage(adapter, error, catalogOn(adapter, executor)))
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
    if (!registered.registered) return undefined;
    // Found under another name: a move followed, and what was refused once may be refused again.
    if (current !== tableName) unaskedRefusals.delete(adapter);
    // The names it was registered under before stay registered otherwise, and still carry the
    // legacy column: a process that followed every move would never read as settled.
    retractOtherNames(
      adapter,
      candidates.filter(name => name !== current)
    );
    // What a server settled at its start about the group's translations, it settled under the
    // companion's old name. A write on a transaction its caller opened can read that answer and
    // never ask for it, and would take the new companion for one that is not there yet.
    if (storesPerLanguage(group)) {
      await isCompanionReady(
        adapter,
        `${current}${STORAGE_FORMAT.companionSuffix}`
      );
    }
    return current;
  }
  return undefined;
}

/**
 * Retract the runtime tables registered under `names`, and their companions: names a followed
 * group's table had before it moved.
 */
function retractOtherNames(
  adapter: DrizzleAdapter,
  names: readonly string[]
): void {
  const registry = (getSchemaRegistryFromDI() ??
    (adapter as unknown as { tableResolver?: unknown }).tableResolver) as
    | { retractDynamicSchema?: (name: string) => void }
    | null
    | undefined;
  if (typeof registry?.retractDynamicSchema !== "function") return;
  for (const name of names) {
    registry.retractDynamicSchema(name);
    registry.retractDynamicSchema(`${name}${STORAGE_FORMAT.companionSuffix}`);
  }
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
