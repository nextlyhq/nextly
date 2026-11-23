/**
 * A change that keeps its entity but removes one of its columns or tables never takes with it an
 * element another owner built there: an index, foreign key or check on a column it removes, or any
 * element on a table it removes. Asked once over the deletions the change's statements make (every
 * file of it, in run order: the main file, the translation files beside it, a many-to-many's join
 * table), before any statement runs, so nothing is removed that its owner did not remove first.
 *
 * Who built what is read from the same two records a whole-entity delete reads
 * (`dependent-elements.ts`): the compiled extension schema, and the element rows
 * `nextly_schema_owners` keeps, which outlive the configuration that declared them. A removed
 * column's elements are told by the columns they stand on: the compiled schema's where it declares
 * them, the database's catalog otherwise. One whose columns cannot be told (a check, an index on an
 * expression, a foreign key SQLite gives no name) is refused rather than guessed about. A record that
 * cannot be read refuses the change: it is never taken for "none".
 *
 * A foreign key pointing at what the change removes is taken with it too: one into a removed table
 * from a table the change keeps, or one into a removed column, unless the change removes the key's
 * own columns as well (then it goes with them, judged as an element on its own table). Every key
 * Nextly makes points at an entry's `id`, which a field change never removes, so such a key is
 * another's, and is refused unless what records owners names the app as its owner.
 *
 * An element another owner keeps elsewhere on a table the change keeps does not stop it.
 *
 * @module domains/schema/ownership/removed-elements
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { SCHEMA_OWNERS_TABLE } from "../../../schemas/schema-owners";
import { getActiveExtensionSchema } from "../extension/active-schema";
import type { SchemaOwner } from "../extension/types";
import type { Deletion } from "../migrate/data-loss-consent";
import type {
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../pipeline/diff/types";
import {
  readForeignKeyColumns,
  readIndexColumns,
  readReferencingTables,
} from "../pipeline/live-table-facts";

import {
  describeOwner,
  distinctElements,
  elementsAddedTo,
  elementsFromOwnerRows,
  readRecordedElementsOn,
  type ElementOnTable,
  type ExtensionSchemaRecord,
  type RecordedElementsAdapter,
} from "./dependent-elements";
import type { OwnerRecord } from "./owner-registry";
import { SchemaOwnersRepository } from "./schema-owners-repository";

/** Where the change's check reads who built what, and the columns each element stands on. */
export interface RemovedElementsSources {
  /** The compiled extension schema, or `null` when nothing declares one. */
  extensionSchema(): Promise<ExtensionSchemaRecord | null>;
  /** The element rows `nextly_schema_owners` keeps for these tables. */
  recordedElements(
    tables: readonly string[]
  ): Promise<readonly ElementOnTable[]>;
  /** The table's indexes that stand on whole columns, with those columns, by index name. */
  indexColumns(table: string): Promise<ReadonlyMap<string, readonly string[]>>;
  /** The table's foreign keys by the column each is on: their names, none where the database keeps none. */
  foreignKeyColumns(
    table: string
  ): Promise<ReadonlyMap<string, readonly string[]>>;
  /** The foreign keys the database holds that point at the table, from any table. */
  keysInto(table: string): Promise<readonly KeyInto[]>;
}

/** A foreign key pointing at a table: the table it is on, its name, its columns, and the columns it points at. */
export interface KeyInto {
  table: string;
  name: string;
  columns: readonly string[];
  referencesColumns: readonly string[];
}

/**
 * The foreign keys the database holds that point at `table`, each with the columns it points at,
 * read from the catalog of every table that references it.
 */
export async function liveKeysInto(
  db: unknown,
  dialect: SupportedDialect,
  table: string
): Promise<KeyInto[]> {
  const referencing = await readReferencingTables(db, dialect, table);
  if (referencing.length === 0) return [];
  const { introspectLiveSnapshot } = await import(
    "../pipeline/diff/introspect-live"
  );
  const snapshot = await introspectLiveSnapshot(db, dialect, referencing);
  const target = table.toLowerCase();
  return snapshot.tables.flatMap(on =>
    (on.foreignKeys ?? [])
      .filter(key => key.referencesTable.toLowerCase() === target)
      .map(key => ({
        table: on.name,
        name: key.name,
        columns: key.columns,
        referencesColumns: key.referencesColumns,
      }))
  );
}

/**
 * What a schema push judges by: the compiled extension schema it applies, the owner rows it read
 * and brought up to date where it found the registry, and the live catalog through `db`. Where it
 * did not (`rows` undefined, the registry absent or its probe unanswered), the rows are asked of
 * the database again, failing closed (`readRecordedElementsThrough`).
 */
export function pushRemovedElementsSources(input: {
  db: unknown;
  dialect: SupportedDialect;
  extensions: ExtensionSchemaRecord | null;
  rows: readonly OwnerRecord[] | undefined;
}): RemovedElementsSources {
  const { db, dialect, rows } = input;
  return {
    extensionSchema: () => Promise.resolve(input.extensions),
    recordedElements: tables =>
      rows === undefined
        ? readRecordedElementsThrough(db, dialect, tables)
        : Promise.resolve(
            elementsFromOwnerRows(
              rows.filter(row => tables.includes(row.tableName))
            )
          ),
    indexColumns: table => readIndexColumns(db, dialect, table),
    foreignKeyColumns: table => readForeignKeyColumns(db, dialect, table),
    keysInto: table => liveKeysInto(db, dialect, table),
  };
}

/**
 * The element rows `nextly_schema_owners` keeps for `tables`, read through `db`. A registry the
 * database lacks has recorded nothing; a question about it that fails is thrown, never taken for an
 * absent registry, so the check refuses rather than counting the elements as none.
 */
export async function readRecordedElementsThrough(
  db: unknown,
  dialect: SupportedDialect,
  tables: readonly string[]
): Promise<ElementOnTable[]> {
  if (tables.length === 0) return [];
  const { introspectTableNames } = await import(
    "../pipeline/diff/introspect-live"
  );
  const present = await introspectTableNames(db, dialect, [
    SCHEMA_OWNERS_TABLE,
  ]);
  if (present.length === 0) return [];
  return elementsFromOwnerRows(
    await new SchemaOwnersRepository(db, dialect).read(tables)
  );
}

/**
 * The sources a change's check reads from a database: the extension schema this process published
 * at boot or on its last reload, the owner record's element rows, and the catalog's columns. Read
 * when the check asks, so a failure to read any refuses the change.
 */
export function databaseRemovedElementsSources(
  adapter: RecordedElementsAdapter,
  dialect: SupportedDialect
): RemovedElementsSources {
  return {
    extensionSchema: () =>
      Promise.resolve().then(() => getActiveExtensionSchema(dialect)),
    recordedElements: tables => readRecordedElementsOn(adapter, tables),
    indexColumns: table =>
      readIndexColumns(adapter.getDrizzle(), dialect, table),
    foreignKeyColumns: table =>
      readForeignKeyColumns(adapter.getDrizzle(), dialect, table),
    keysInto: table => liveKeysInto(adapter.getDrizzle(), dialect, table),
  };
}

/**
 * What a schema push's operations remove, as the deletions the check reads: each table it drops and
 * each column it drops. A rename keeps its column, and what stands on it, under the new name.
 */
export function deletionsOfOperations(
  operations: readonly Operation[]
): Deletion[] {
  return operations.flatMap((op): Deletion[] =>
    op.type === "drop_table"
      ? [{ kind: "table", table: op.tableName }]
      : op.type === "drop_column"
        ? [{ kind: "column", table: op.tableName, column: op.columnName }]
        : []
  );
}

/**
 * `snapshot` without the elements another owner built that `elements` records: what the app's own
 * history describes of its tables, which never records another owner's column, index, foreign key
 * or check. A table read from the database and compared with that history is read this way, so an
 * element a plugin migration built there is not taken for drift.
 */
export function withoutOthersElements(
  snapshot: NextlySchemaSnapshot,
  elements: readonly ElementOnTable[]
): NextlySchemaSnapshot {
  const others = elements.filter(element => element.owner.kind !== "app");
  if (others.length === 0) return snapshot;
  const named = (table: TableSpec, kind: ElementOnTable["kind"]) =>
    new Set(
      others
        .filter(
          element =>
            element.kind === kind &&
            element.table.toLowerCase() === table.name.toLowerCase()
        )
        .map(element => element.name.toLowerCase())
    );
  const keep = <T extends { name: string }>(
    list: T[] | undefined,
    gone: ReadonlySet<string>
  ): T[] | undefined =>
    list === undefined || gone.size === 0
      ? list
      : list.filter(each => !gone.has(each.name.toLowerCase()));
  return {
    ...snapshot,
    tables: snapshot.tables.map(table => {
      const columns = keep(table.columns, named(table, "column")) ?? [];
      const indexes = keep(table.indexes, named(table, "index"));
      const foreignKeys = keep(table.foreignKeys, named(table, "fk"));
      const checks = keep(table.checks, named(table, "check"));
      return {
        ...table,
        columns,
        ...(indexes === undefined ? {} : { indexes }),
        ...(foreignKeys === undefined ? {} : { foreignKeys }),
        ...(checks === undefined ? {} : { checks }),
      };
    }),
  };
}

/** An element another owner built that the change would take with it, and why. */
interface Taken {
  /** The element: its owner is `null` for a key into what is removed that no owner record names. */
  element: Omit<ElementOnTable, "owner"> & { owner: SchemaOwner | null };
  /** The removed table it points at, for a key into what is removed rather than on it. */
  pointsAt?: string;
  /** The field whose removal takes it, where the caller can name one. */
  field?: string;
  /** The removed column it stands on, or none where its table goes whole or its columns are unknown. */
  column?: string;
  /** Its columns cannot be told, so it is refused rather than guessed about. */
  unknownColumns?: true;
}

/**
 * Refuse the change, before any statement, where its deletions take an element another owner built:
 * each named with its owner, its kind, its table and the field that takes it.
 */
export async function refuseRemovingOthersElements(args: {
  deletions: readonly Deletion[];
  sources: RemovedElementsSources;
  dialect: SupportedDialect;
  /** How the refusal names the entity: "Collection 'posts'". */
  entity: string;
  /** The field a removed column, or a removed table such as a join table, belongs to. */
  fieldOf?: (table: string, column?: string) => string | undefined;
}): Promise<void> {
  const tablesRemoved = new Set<string>();
  const columnsRemoved = new Map<string, Set<string>>();
  for (const deletion of args.deletions) {
    if (deletion.core === true) continue;
    if (deletion.kind === "table") tablesRemoved.add(deletion.table);
    if (deletion.kind === "column") {
      const columns = columnsRemoved.get(deletion.table) ?? new Set<string>();
      columns.add(deletion.column.toLowerCase());
      columnsRemoved.set(deletion.table, columns);
    }
  }
  for (const table of tablesRemoved) columnsRemoved.delete(table);
  const tables = [...tablesRemoved, ...columnsRemoved.keys()];
  if (tables.length === 0) return;

  const taken = await readingOthersElements(args.entity, async () => {
    const schema = await args.sources.extensionSchema();
    const elements = distinctElements([
      ...(schema === null ? [] : await elementsAddedTo(schema, tables)),
      ...(await args.sources.recordedElements(tables)),
    ]).filter(element => element.owner.kind !== "app");
    const found: Taken[] = [];
    for (const element of elements) {
      if (tablesRemoved.has(element.table)) {
        found.push({ element, ...fieldOf(args, element.table) });
        continue;
      }
      const removed = columnsRemoved.get(element.table);
      if (removed === undefined || element.kind === "column") continue;
      const stands = await columnsOf(
        element,
        schema,
        args.sources,
        args.dialect,
        removed
      );
      if (stands === "unknown") {
        // Named by the fields whose columns the change removes from its table, any of which it
        // may stand on.
        const fields = [...removed].flatMap(
          column => fieldOf(args, element.table, column).field ?? []
        );
        found.push({
          element,
          unknownColumns: true,
          ...(fields.length > 0 ? { field: fields.join('", "') } : {}),
        });
        continue;
      }
      const column = stands.find(each => removed.has(each.toLowerCase()));
      if (column !== undefined) {
        found.push({
          element,
          column,
          ...fieldOf(args, element.table, column),
        });
      }
    }
    found.push(
      ...(await keysTaken(args, schema, tablesRemoved, columnsRemoved))
    );
    return found;
  });
  if (taken.length === 0) return;
  throw NextlyError.conflict({
    message:
      `${args.entity}: this change would remove what another owner built on its tables, so nothing was changed. ` +
      taken.map(describeTaken).join(" ") +
      " Its owner removes it first, or the change keeps what it stands on.",
    logContext: {
      reason: "field-change-removes-others-elements",
      elements: taken.map(({ element, field, column }) => ({
        owner: ownerWords(element.owner),
        kind: element.kind,
        name: element.name,
        table: element.table,
        ...(field === undefined ? {} : { field }),
        ...(column === undefined ? {} : { column }),
      })),
    },
  });
}

/**
 * The foreign keys pointing at what the change removes: into a removed table from a table it keeps,
 * or into a removed column. One whose owner is the app (`ownerOfKey`) is the app's own to answer for.
 */
async function keysTaken(
  args: {
    sources: RemovedElementsSources;
    fieldOf?: (table: string, column?: string) => string | undefined;
  },
  schema: ExtensionSchemaRecord | null,
  tablesRemoved: ReadonlySet<string>,
  columnsRemoved: ReadonlyMap<string, ReadonlySet<string>>
): Promise<Taken[]> {
  const found: Taken[] = [];
  for (const target of [...tablesRemoved, ...columnsRemoved.keys()]) {
    const removed = columnsRemoved.get(target);
    const keys = (await args.sources.keysInto(target)).filter(key =>
      pointsAtRemoved(key, removed, tablesRemoved, columnsRemoved)
    );
    if (keys.length === 0) continue;
    const on = [...new Set(keys.map(key => key.table))];
    const known = distinctElements([
      ...(schema === null ? [] : await elementsAddedTo(schema, on)),
      ...(await args.sources.recordedElements(on)),
    ]);
    for (const key of keys) {
      const owner = ownerOfKey(key, known, schema);
      if (owner?.kind !== "app") {
        found.push(keyTaken(args, key, owner, target, removed));
      }
    }
  }
  return found;
}

/**
 * Whether a key into `removed`'s table is taken by the change: it points at a removed column (or,
 * with `removed` undefined, its table is removed whole), and its own columns stay.
 */
function pointsAtRemoved(
  key: KeyInto,
  removed: ReadonlySet<string> | undefined,
  tablesRemoved: ReadonlySet<string>,
  columnsRemoved: ReadonlyMap<string, ReadonlySet<string>>
): boolean {
  if (goesWithItsColumns(key, tablesRemoved, columnsRemoved)) return false;
  return (
    removed === undefined ||
    key.referencesColumns.some(column => removed.has(column.toLowerCase()))
  );
}

/** A key into `target` as a taken element: the removed column it points at, and its field. */
function keyTaken(
  args: { fieldOf?: (table: string, column?: string) => string | undefined },
  key: KeyInto,
  owner: SchemaOwner | null,
  target: string,
  removed: ReadonlySet<string> | undefined
): Taken {
  const column = key.referencesColumns.find(
    each => removed?.has(each.toLowerCase()) === true
  );
  return {
    element: { owner, kind: "fk", name: key.name, table: key.table },
    pointsAt: target,
    ...(column === undefined ? {} : { column }),
    ...fieldOf(args, target, column),
  };
}

/**
 * Who built a key: the owner of the key element of its name, else of a column element it stands on
 * (SQLite keeps no key names, so a recorded key is told there by its column), else the plugin whose
 * table it is on. `null` where none says.
 */
function ownerOfKey(
  key: KeyInto,
  known: readonly ElementOnTable[],
  schema: ExtensionSchemaRecord | null
): SchemaOwner | null {
  const lower = (name: string) => name.toLowerCase();
  const onItsTable = known.filter(
    element => lower(element.table) === lower(key.table)
  );
  const named = onItsTable.find(
    element => element.kind === "fk" && lower(element.name) === lower(key.name)
  );
  const column = onItsTable.find(
    element =>
      element.kind === "column" &&
      key.columns.some(each => lower(each) === lower(element.name))
  );
  const table = schema?.owners.get(key.table);
  return (
    named?.owner ?? column?.owner ?? (table?.kind === "plugin" ? table : null)
  );
}

/** Whether the change removes the key's own table, or every column it is on. */
function goesWithItsColumns(
  key: KeyInto,
  tablesRemoved: ReadonlySet<string>,
  columnsRemoved: ReadonlyMap<string, ReadonlySet<string>>
): boolean {
  if (tablesRemoved.has(key.table)) return true;
  const removed = columnsRemoved.get(key.table);
  return (
    removed !== undefined &&
    key.columns.length > 0 &&
    key.columns.every(column => removed.has(column.toLowerCase()))
  );
}

/** An owner as the refusal's log names it; a key whose owner nothing says is unknown. */
function ownerWords(owner: SchemaOwner | null): string {
  return owner === null ? "unknown" : describeOwner(owner);
}

/** The field the caller names for a removed table or column, where it names one. */
function fieldOf(
  args: { fieldOf?: (table: string, column?: string) => string | undefined },
  table: string,
  column?: string
): { field?: string } {
  const field = args.fieldOf?.(table, column);
  return field === undefined ? {} : { field };
}

/**
 * The columns `element` stands on: from the compiled schema where it declares them, else the
 * database's catalog; `"unknown"` where neither can tell.
 */
async function columnsOf(
  element: ElementOnTable,
  schema: ExtensionSchemaRecord | null,
  sources: RemovedElementsSources,
  dialect: SupportedDialect,
  removed: ReadonlySet<string>
): Promise<readonly string[] | "unknown"> {
  if (element.kind === "index") return indexColumns(element, schema, sources);
  if (element.kind === "fk") {
    return foreignKeyColumns(element, schema, sources, dialect, removed);
  }
  // A check's columns are in its expression, which is not read here.
  return "unknown";
}

/** An index's columns: as the compiled schema declares them, else as the catalog lists them. */
async function indexColumns(
  element: ElementOnTable,
  schema: ExtensionSchemaRecord | null,
  sources: RemovedElementsSources
): Promise<readonly string[] | "unknown"> {
  const name = element.name.toLowerCase();
  const { resolveIndexName } = await import("../extension/compile");
  const declared = (schema?.entityIndexes.get(element.table) ?? []).find(
    index => resolveIndexName(element.table, index).toLowerCase() === name
  );
  // An index on an expression names no columns, and is told by the catalog or not at all.
  if (declared !== undefined && declared.expression === undefined) {
    return declared.columns;
  }
  const live = [...(await sources.indexColumns(element.table))].find(
    ([index]) => index.toLowerCase() === name
  );
  return live === undefined ? "unknown" : live[1];
}

/**
 * A foreign key's columns: as the compiled schema declares them, else the catalog's columns that
 * carry a key of its name. SQLite keeps no constraint names, so a key on a removed column there may
 * be this one, and its columns are unknown.
 */
async function foreignKeyColumns(
  element: ElementOnTable,
  schema: ExtensionSchemaRecord | null,
  sources: RemovedElementsSources,
  dialect: SupportedDialect,
  removed: ReadonlySet<string>
): Promise<readonly string[] | "unknown"> {
  const name = element.name.toLowerCase();
  const declared = schema?.specs
    .find(spec => spec.name === element.table)
    ?.foreignKeys?.find(key => key.name.toLowerCase() === name);
  if (declared !== undefined) return declared.columns;
  const keys = [...(await sources.foreignKeyColumns(element.table))];
  const on = keys
    .filter(([, names]) => names.some(each => each.toLowerCase() === name))
    .map(([column]) => column);
  if (on.length > 0 || dialect !== "sqlite") return on;
  return keys.some(([column]) => removed.has(column.toLowerCase()))
    ? "unknown"
    : [];
}

/** One taken element as a person reads it. */
function describeTaken({
  element,
  pointsAt,
  field,
  column,
  unknownColumns,
}: Taken): string {
  const what =
    element.owner === null
      ? `the ${element.kind} "${element.name}" on ${element.table}`
      : `${describeOwner(element.owner)}'s ${element.kind} "${element.name}" on ${element.table}`;
  const by = field === undefined ? "The change" : `Removing "${field}"`;
  if (pointsAt !== undefined) {
    return column === undefined
      ? `${by} removes ${pointsAt}, which ${what} points at.`
      : `${by} removes the column ${column} of ${pointsAt}, which ${what} points at.`;
  }
  if (unknownColumns === true) {
    return `${by} removes columns of ${element.table}, and which columns ${what} stands on cannot be told, so it is not removed blind.`;
  }
  return column === undefined
    ? `${by} removes ${element.table}, with ${what}.`
    : `${by} removes the column ${column}, which ${what} stands on.`;
}

/**
 * Run `reading`, refusing where a record of other owners' elements cannot be read: the elements are
 * then unknown, and nothing is changed over what may be there. `entity` names what was not changed.
 */
export async function readingOthersElements<T>(
  entity: string,
  reading: () => Promise<T>
): Promise<T> {
  try {
    return await reading();
  } catch (error) {
    throw NextlyError.serviceUnavailable({
      publicMessage: `${entity} was not changed, because the record of what other owners built on its tables could not be read, so whether the change removes any of it is unknown. Nothing was removed. Fix the cause in the server log and try again.`,
      ...(error instanceof Error ? { cause: error } : {}),
      logContext: {
        reason: "field-change-removes-others-elements-unreadable",
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
