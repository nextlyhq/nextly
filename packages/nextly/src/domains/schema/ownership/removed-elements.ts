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
 * A foreign key pointing at what the change removes is taken with it too: one into a removed column,
 * or one another owner built into a removed table from columns the change keeps. Every key Nextly
 * makes points at an entry's `id`, which a field change never removes, so a key into a removed
 * column is another's, and is refused unless what records owners names the app as its owner. A key
 * into a removed table whose owner nothing names is a relationship Nextly made to that table's `id`,
 * and goes with it, as when a collection is deleted.
 *
 * What an owner removes of its own takes its own elements with it: a still-configured plugin that
 * stops declaring a column has what it built on that column removed too.
 *
 * An element another owner keeps elsewhere on a table the change keeps does not stop it.
 *
 * @module domains/schema/ownership/removed-elements
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

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
  readIndexNames,
  readReferencingKeys,
  readReferencingTables,
} from "../pipeline/live-table-facts";
import {
  fieldsStoredOnRow,
  getColumnDescriptor,
  toSnakeCase,
} from "../services/field-column-descriptor";

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
import {
  SchemaOwnersRepository,
  schemaOwnersTableExists,
  tableOwnersByName,
} from "./schema-owners-repository";

/**
 * An identifier as the check compares it: ASCII letters folded, nothing else, as SQLite folds a
 * name (`Ä` and `ä` are two names) and as unquoted names fold on PostgreSQL and MySQL.
 */
function fold(name: string): string {
  return name.replace(/[A-Z]/g, letter => letter.toLowerCase());
}

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
  /** The names of every index the table has, expression and prefix indexes included. */
  indexNames(table: string): Promise<ReadonlySet<string>>;
  /** The table's foreign keys by the column each is on: their names, none where the database keeps none. */
  foreignKeyColumns(
    table: string
  ): Promise<ReadonlyMap<string, readonly string[]>>;
  /** The foreign keys the database holds that point at the table, from any table. */
  keysInto(table: string): Promise<readonly KeyInto[]>;
  /**
   * The plugins the owner record names as owning these tables, by folded table name: a record
   * outlives the configuration that named its plugin.
   */
  tableOwners(
    tables: readonly string[]
  ): Promise<ReadonlyMap<string, SchemaOwner>>;
  /**
   * The database's own spellings of a table the change names, whatever case it wrote: none where
   * the database has no such table.
   */
  liveNames(table: string): Promise<readonly string[]>;
}

/** A foreign key pointing at a table: the table it is on, its name, its columns, and the columns it points at. */
export interface KeyInto {
  table: string;
  name: string;
  columns: readonly string[];
  referencesColumns: readonly string[];
}

/**
 * The foreign keys the database holds that point at `table`, each with the columns it points at.
 *
 * On PostgreSQL and MySQL they are read by relation identity (`readReferencingKeys`), so a key on
 * a table in another schema or database is found, named as an unqualified statement reaches its
 * table. SQLite has neither, and its keys are read from the catalog of every table that references
 * `table`.
 */
export async function liveKeysInto(
  db: unknown,
  dialect: SupportedDialect,
  table: string
): Promise<KeyInto[]> {
  // A table that is not there has no key pointing at it.
  if ((await liveNamesOf(db, dialect, table)).length === 0) return [];
  if (dialect !== "sqlite") {
    return (await readReferencingKeys(db, dialect, { table })).map(key => ({
      table: key.childTable,
      name: key.name,
      columns: key.columns,
      referencesColumns: key.referencesColumns,
    }));
  }
  const referencing = await readReferencingTables(db, dialect, table);
  if (referencing.length === 0) return [];
  const { introspectLiveSnapshot } = await import(
    "../pipeline/diff/introspect-live"
  );
  const snapshot = await introspectLiveSnapshot(db, dialect, referencing);
  const target = fold(table);
  return snapshot.tables.flatMap(on =>
    (on.foreignKeys ?? [])
      .filter(key => fold(key.referencesTable) === target)
      .map(key => ({
        table: on.name,
        name: key.name,
        columns: key.columns,
        referencesColumns: key.referencesColumns,
      }))
  );
}

/** The live spellings of `table`, whose name the change may have written in another case. */
async function liveNamesOf(
  db: unknown,
  dialect: SupportedDialect,
  table: string
): Promise<string[]> {
  const { introspectTableNames } = await import(
    "../pipeline/diff/introspect-live"
  );
  return introspectTableNames(db, dialect, [table]);
}

/**
 * The plugins `rows` record as owning a table, by folded name. A row of the app's own, or of an
 * entity, says nothing a key is judged by.
 */
function pluginTableOwners(
  rows: readonly OwnerRecord[]
): Map<string, SchemaOwner> {
  const owners = new Map<string, SchemaOwner>();
  for (const [table, row] of tableOwnersByName(rows)) {
    if (row.ownerKind === "plugin") {
      owners.set(fold(table), { kind: "plugin", id: row.ownerId });
    }
  }
  return owners;
}

/**
 * What a schema push or a migration run judges by: the compiled extension schema it applies, the
 * owner rows it already read, and the live catalog through `db`. Where it has none (`rows`
 * undefined: a push whose probe of the registry went unanswered), the rows are asked of the
 * database again, failing closed (`readRecordedElementsThrough`).
 */
export function removedElementsSourcesOn(input: {
  db: unknown;
  dialect: SupportedDialect;
  extensions: ExtensionSchemaRecord | null;
  rows: readonly OwnerRecord[] | undefined;
}): RemovedElementsSources {
  const { db, dialect, rows } = input;
  const ownerRows = async (
    tables: readonly string[]
  ): Promise<readonly OwnerRecord[]> => {
    if (rows === undefined) return readOwnerRowsThrough(db, dialect, tables);
    const wanted = new Set(tables.map(fold));
    return rows.filter(row => wanted.has(fold(row.tableName)));
  };
  return {
    extensionSchema: () => Promise.resolve(input.extensions),
    recordedElements: async tables =>
      elementsFromOwnerRows(await ownerRows(tables)),
    tableOwners: async tables => pluginTableOwners(await ownerRows(tables)),
    indexColumns: table => readIndexColumns(db, dialect, table),
    indexNames: table => readIndexNames(db, dialect, table),
    foreignKeyColumns: table => readForeignKeyColumns(db, dialect, table),
    keysInto: table => liveKeysInto(db, dialect, table),
    liveNames: table => liveNamesOf(db, dialect, table),
  };
}

/** The owner rows `nextly_schema_owners` keeps for `tables`, read through `db`. */
async function readOwnerRowsThrough(
  db: unknown,
  dialect: SupportedDialect,
  tables: readonly string[]
): Promise<OwnerRecord[]> {
  if (tables.length === 0) return [];
  const present = await liveNamesOf(db, dialect, SCHEMA_OWNERS_TABLE);
  if (present.length === 0) return [];
  return new SchemaOwnersRepository(db, dialect).read(tables);
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
  return elementsFromOwnerRows(await readOwnerRowsThrough(db, dialect, tables));
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
    tableOwners: async tables =>
      tables.length > 0 && (await schemaOwnersTableExists(adapter))
        ? pluginTableOwners(
            await new SchemaOwnersRepository(
              adapter.getDrizzle(),
              dialect
            ).read(tables)
          )
        : new Map(),
    liveNames: table => liveNamesOf(adapter.getDrizzle(), dialect, table),
    indexColumns: table =>
      readIndexColumns(adapter.getDrizzle(), dialect, table),
    indexNames: table => readIndexNames(adapter.getDrizzle(), dialect, table),
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
 * element a plugin migration built there is not taken for drift. An index or foreign key standing on
 * a column left out goes with it: SQLite keeps no name for a key declared with its column, so the
 * record's name cannot find it there, but the column it stands on can.
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
            element.kind === kind && fold(element.table) === fold(table.name)
        )
        .map(element => fold(element.name))
    );
  return {
    ...snapshot,
    tables: snapshot.tables.map(table => {
      const hidden = named(table, "column");
      const recorded = {
        column: hidden,
        index: named(table, "index"),
        fk: named(table, "fk"),
        check: named(table, "check"),
      };
      return tableWithout(
        table,
        (kind, element) =>
          recorded[kind].has(fold(element.name)) ||
          // An index or foreign key on a column left out goes with it.
          ((kind === "index" || kind === "fk") &&
            (element.columns ?? []).some(column => hidden.has(fold(column))))
      );
    }),
  };
}

/** `table` without the elements `gone` says to leave out, kinds it does not track left as they are. */
export function tableWithout(
  table: TableSpec,
  gone: (
    kind: ElementOnTable["kind"],
    element: { name: string; columns?: readonly string[] }
  ) => boolean
): TableSpec {
  const keep = <T extends { name: string; columns?: readonly string[] }>(
    kind: ElementOnTable["kind"],
    list: T[] | undefined
  ): T[] | undefined => list?.filter(each => !gone(kind, each));
  const indexes = keep("index", table.indexes);
  const foreignKeys = keep("fk", table.foreignKeys);
  const checks = keep("check", table.checks);
  return {
    ...table,
    columns: keep("column", table.columns) ?? [],
    ...(indexes === undefined ? {} : { indexes }),
    ...(foreignKeys === undefined ? {} : { foreignKeys }),
    ...(checks === undefined ? {} : { checks }),
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
  /**
   * The deletions name tables as the database has them, as a push's do. Left out, they were read
   * from statements, whose names are lower-cased, so every live table of the name is judged.
   */
  exactNames?: boolean;
  sources: RemovedElementsSources;
  dialect: SupportedDialect;
  /** How the refusal names the entity: "Collection 'posts'". */
  entity: string;
  /** The field a removed column, or a removed table such as a join table, belongs to. */
  fieldOf?: (table: string, column?: string) => string | undefined;
}): Promise<void> {
  const tablesRemoved = new Set<string>();
  const columnsRemoved = new Map<string, Set<string>>();
  // Each table by its folded name, as the change wrote it: two of one name where it touches both.
  const written = new Map<string, Set<string>>();
  for (const deletion of args.deletions) {
    if (deletion.core === true) continue;
    if (deletion.kind !== "table" && deletion.kind !== "column") continue;
    const table = fold(deletion.table);
    written.set(table, (written.get(table) ?? new Set()).add(deletion.table));
    if (deletion.kind === "table") {
      tablesRemoved.add(table);
    } else {
      const columns = columnsRemoved.get(table) ?? new Set<string>();
      columns.add(fold(deletion.column));
      columnsRemoved.set(table, columns);
    }
  }
  for (const table of tablesRemoved) columnsRemoved.delete(table);
  if (written.size === 0) return;

  const taken = await readingOthersElements(args.entity, async () => {
    const schema = await args.sources.extensionSchema();
    const spellings = await tableSpellings(
      args.sources,
      [...tablesRemoved, ...columnsRemoved.keys()],
      written,
      args.exactNames === true
    );
    const tables = [...spellings.values()].flatMap(each => each.all);
    const all = distinctElements([
      ...(schema === null ? [] : await elementsAddedTo(schema, tables)),
      ...(await args.sources.recordedElements(tables)),
    ]);
    const removedBy = removedOwners(
      all,
      schema,
      await args.sources.tableOwners(tables),
      spellings
    );
    const found: Taken[] = [];
    for (const element of all) {
      if (element.owner.kind === "app") continue;
      const one = await elementTaken(args, element, schema, removedBy, {
        tablesRemoved,
        columnsRemoved,
        spellings,
      });
      if (one !== undefined) found.push(one);
    }
    found.push(
      ...(await keysTaken(args, schema, removedBy, found, {
        tablesRemoved,
        columnsRemoved,
        spellings,
      }))
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

/** How one table the change names is spelled, for the lookups each reads it by. */
interface TableSpellings {
  /** Every spelling an owner record or the compiled schema may give it. */
  all: readonly string[];
  /** The database's tables of the name the change touches, or the change's own where it has none. */
  live: readonly string[];
  /** Every table the database has whose name folds alike, the ones the change does not touch too. */
  alike: readonly string[];
}

/** The removed table `name` is, by its folded name, or undefined where the change touches none so. */
function removedTableOf(
  spellings: ReadonlyMap<string, TableSpellings>,
  name: string
): string | undefined {
  const key = fold(name);
  const spelled = spellings.get(key);
  if (spelled === undefined) return undefined;
  // Where the database has another table of that name in another case, it is the one so spelled.
  return spelled.live.includes(name) || !spelled.alike.includes(name)
    ? key
    : undefined;
}

/**
 * The spellings of each removed table, by its folded name: as the change wrote it, and as the
 * database has it (`posts` for a quoted `"Posts"`, say). Where the database has the very name the
 * change wrote, that one table is meant; only where it has none does another spelling of the name
 * count. A table the database lacks is asked by the change's own spelling.
 */
async function tableSpellings(
  sources: RemovedElementsSources,
  folded: readonly string[],
  written: ReadonlyMap<string, ReadonlySet<string>>,
  exactNames: boolean
): Promise<ReadonlyMap<string, TableSpellings>> {
  const spellings = new Map<string, TableSpellings>();
  for (const table of folded) {
    const own = [...(written.get(table) ?? [table])];
    const alike = await sources.liveNames(table);
    const exact = exactNames ? own.filter(name => alike.includes(name)) : [];
    const meant = exact.length > 0 ? exact : alike;
    spellings.set(table, {
      all: [...new Set([...own, ...meant])],
      live: meant.length > 0 ? meant : own,
      alike,
    });
  }
  return spellings;
}

/**
 * Refuse a migration run, before its first file, where one of its files removes what another owner
 * built on the app's tables. The files are read as one list (`runDeletions`), each judged as the
 * files before it leave the database, and the refusal names the file. Judging file by file as each
 * comes up would leave the earlier ones applied and recorded when a later one is refused.
 */
export async function refuseRunRemovingOthersElements(args: {
  /** The run's files, in run order: each one's name, and its statements. */
  files: readonly { name: string; statements: readonly string[] }[];
  db: unknown;
  dialect: SupportedDialect;
  sources: RemovedElementsSources;
}): Promise<void> {
  if (args.files.length === 0) return;
  const { readDeletionFacts, runDeletions, runStatements } = await import(
    "../migrate/file-deletions"
  );
  const lists = args.files.map(file => file.statements);
  const perFile = runDeletions(
    lists,
    args.dialect,
    await readDeletionFacts(args.db, args.dialect, runStatements(lists))
  );
  for (const [at, file] of args.files.entries()) {
    await refuseRemovingOthersElements({
      deletions: perFile[at] ?? [],
      dialect: args.dialect,
      entity: `Migration ${file.name}.sql`,
      sources: args.sources,
      // A file has the fields' columns, not their definitions: each column names its field.
      fieldOf: (_table, column) => column,
    });
  }
}

/** Who a removed table or column belongs to, as the check compares it with an element's owner. */
interface RemovedOwners {
  table(table: string): SchemaOwner | undefined;
  column(table: string, column: string): SchemaOwner;
}

/**
 * The owners of what the change removes. A column is its column element's owner where one names
 * it, else its table's: an entity's own field is the app's. A table is the owner the compiled
 * schema gives it, or the plugin the owner record names (a plugin no configuration still names).
 */
function removedOwners(
  all: readonly ElementOnTable[],
  schema: ExtensionSchemaRecord | null,
  recorded: ReadonlyMap<string, SchemaOwner>,
  spellings: ReadonlyMap<string, TableSpellings>
): RemovedOwners {
  const compiled = new Map(
    [...(schema?.owners ?? [])].map(([name, owner]) => [fold(name), owner])
  );
  const tableOwner = (table: string) =>
    compiled.get(fold(table)) ?? recorded.get(fold(table));
  return {
    table: tableOwner,
    column: (table, column) =>
      all.find(
        element =>
          element.kind === "column" &&
          removedTableOf(spellings, element.table) === fold(table) &&
          fold(element.name) === fold(column)
      )?.owner ??
      tableOwner(table) ?? { kind: "app" },
  };
}

/** Whether two owners are one: the app, or the same plugin. */
function sameOwner(a: SchemaOwner | null | undefined, b: SchemaOwner): boolean {
  if (a === null || a === undefined || a.kind !== b.kind) return false;
  return a.kind === "app" || (b.kind === "plugin" && a.id === b.id);
}

/**
 * Whether the change takes `element`, another owner's, with what it removes, and why. What its own
 * owner removes does not take it: a plugin that stops declaring a column removes what it built on
 * that column with it, as the push removes an element a still-configured owner stops declaring.
 */
async function elementTaken(
  args: {
    sources: RemovedElementsSources;
    dialect: SupportedDialect;
    fieldOf?: (table: string, column?: string) => string | undefined;
  },
  element: ElementOnTable,
  schema: ExtensionSchemaRecord | null,
  removedBy: RemovedOwners,
  removal: Removal
): Promise<Taken | undefined> {
  const { columnsRemoved } = removal;
  const at = removedTableOf(removal.spellings, element.table);
  if (at === undefined) return undefined;
  if (removal.tablesRemoved.has(at)) {
    return sameOwner(removedBy.table(element.table), element.owner)
      ? undefined
      : { element, ...fieldOf(args, element.table) };
  }
  const removed = new Set(
    [...(columnsRemoved.get(at) ?? [])].filter(
      column =>
        !sameOwner(removedBy.column(element.table, column), element.owner)
    )
  );
  if (removed.size === 0 || element.kind === "column") return undefined;
  return standsOnRemoved(args, element, schema, removed);
}

/**
 * The element, taken by a removed column of its table it stands on: the column where it can be
 * told, or every column it may stand on where its columns cannot.
 */
async function standsOnRemoved(
  args: {
    sources: RemovedElementsSources;
    dialect: SupportedDialect;
    fieldOf?: (table: string, column?: string) => string | undefined;
  },
  element: ElementOnTable,
  schema: ExtensionSchemaRecord | null,
  removed: ReadonlySet<string>
): Promise<Taken | undefined> {
  const stands = await columnsOf(
    element,
    schema,
    args.sources,
    args.dialect,
    removed
  );
  if (stands === "unknown") {
    // Named by the fields whose columns the change removes from its table, any of which it may
    // stand on.
    const fields = [...removed].flatMap(
      column => fieldOf(args, element.table, column).field ?? []
    );
    return {
      element,
      unknownColumns: true,
      ...(fields.length > 0 ? { field: fields.join('", "') } : {}),
    };
  }
  const column = stands.find(each => removed.has(fold(each)));
  return column === undefined
    ? undefined
    : { element, column, ...fieldOf(args, element.table, column) };
}

/**
 * The foreign keys pointing at what the change removes: into a removed table from a table it keeps,
 * or into a removed column. One whose owner is the app (`ownerOfKey`) is the app's own to answer for,
 * one whose owner removes what it points at goes with it, and one the elements above already name is
 * not named twice.
 */
async function keysTaken(
  args: {
    sources: RemovedElementsSources;
    fieldOf?: (table: string, column?: string) => string | undefined;
  },
  schema: ExtensionSchemaRecord | null,
  removedBy: RemovedOwners,
  already: readonly Taken[],
  removal: Removal
): Promise<Taken[]> {
  const named = new Set(
    already
      .filter(taken => taken.element.kind === "fk")
      .map(taken => keyId(taken.element))
  );
  const found: Taken[] = [];
  for (const target of [
    ...removal.tablesRemoved,
    ...removal.columnsRemoved.keys(),
  ]) {
    found.push(
      ...(await keysIntoTaken(args, schema, removedBy, named, removal, target))
    );
  }
  return found;
}

/** What the change removes, and how it spells the tables of it. */
interface Removal {
  tablesRemoved: ReadonlySet<string>;
  columnsRemoved: ReadonlyMap<string, ReadonlySet<string>>;
  spellings: ReadonlyMap<string, TableSpellings>;
}

/** A key by its table and name, as two readings of one key are matched. */
function keyId(key: { table: string; name: string }): string {
  return fold(`${key.table}\u0000${key.name}`);
}

/** The keys into `target` the change takes, less those `named` already holds. */
async function keysIntoTaken(
  args: {
    sources: RemovedElementsSources;
    fieldOf?: (table: string, column?: string) => string | undefined;
  },
  schema: ExtensionSchemaRecord | null,
  removedBy: RemovedOwners,
  named: ReadonlySet<string>,
  removal: Removal,
  target: string
): Promise<Taken[]> {
  const removed = removal.columnsRemoved.get(target);
  const spelled = removal.spellings.get(target)?.live ?? [target];
  const found: KeyInto[] = [];
  for (const name of spelled)
    found.push(...(await args.sources.keysInto(name)));
  const keys = found.filter(
    key => pointsAtRemoved(key, removed, removal) && !named.has(keyId(key))
  );
  if (keys.length === 0) return [];
  const on = [...new Set(keys.map(key => key.table))];
  const known = distinctElements([
    ...(schema === null ? [] : await elementsAddedTo(schema, on)),
    ...(await args.sources.recordedElements(on)),
  ]);
  const tables = await args.sources.tableOwners(on);
  return keys.flatMap(key => {
    const owner = ownerOfKey(key, known, schema, tables);
    if (!countsKeyOf(owner, removed)) return [];
    const pointed = pointedAt(key, removed);
    return ownsWhatItPointsAt(owner, target, pointed, removedBy)
      ? []
      : [keyTaken(args, key, owner, spelled[0] ?? target, pointed)];
  });
}

/**
 * Whether a key's owner makes it count: never the app's own; and into a table removed whole
 * (`removed` undefined), only one a record names, since one no record names is a relationship Nextly
 * made to that table's `id`.
 */
function countsKeyOf(
  owner: SchemaOwner | null,
  removed: ReadonlySet<string> | undefined
): boolean {
  if (owner?.kind === "app") return false;
  return owner !== null || removed !== undefined;
}

/** The removed columns of its table a key points at: none where the table goes whole. */
function pointedAt(
  key: KeyInto,
  removed: ReadonlySet<string> | undefined
): string[] {
  return removed === undefined
    ? []
    : key.referencesColumns.filter(column => removed.has(fold(column)));
}

/**
 * Whether a key's owner is the owner of what it points at that the change removes: the table, or
 * every removed column it points at, so one other owner's column among them keeps it taken.
 */
function ownsWhatItPointsAt(
  owner: SchemaOwner | null,
  target: string,
  pointed: readonly string[],
  removedBy: RemovedOwners
): boolean {
  if (owner === null) return false;
  if (pointed.length === 0) return sameOwner(removedBy.table(target), owner);
  return pointed.every(column =>
    sameOwner(removedBy.column(target, column), owner)
  );
}

/**
 * Whether a key into `removed`'s table is taken by the change. Into a removed column: always, even
 * where its own columns go too, since no key Nextly makes points at a column a field change removes,
 * so one whose owner nothing names is never the app's. Into a table removed whole (`removed`
 * undefined): where its own columns stay, as a relationship's key into a removed table goes with its
 * field; and `keysTaken` counts it only where a record names its owner.
 */
function pointsAtRemoved(
  key: KeyInto,
  removed: ReadonlySet<string> | undefined,
  removal: Removal
): boolean {
  if (removed !== undefined) {
    return key.referencesColumns.some(column => removed.has(fold(column)));
  }
  return !goesWithItsColumns(key, removal);
}

/** A key into `target` as a taken element: the removed columns it points at, and their fields. */
function keyTaken(
  args: { fieldOf?: (table: string, column?: string) => string | undefined },
  key: KeyInto,
  owner: SchemaOwner | null,
  target: string,
  pointed: readonly string[]
): Taken {
  const fields = pointed.flatMap(
    column => fieldOf(args, target, column).field ?? []
  );
  const named =
    pointed.length === 0
      ? fieldOf(args, target)
      : fields.length > 0
        ? { field: fields.join('", "') }
        : {};
  return {
    element: { owner, kind: "fk", name: key.name, table: key.table },
    pointsAt: target,
    ...(pointed.length === 0 ? {} : { column: pointed.join(", ") }),
    ...named,
  };
}

/**
 * Who built a key: the owner of the key element of its name, else of a column element it stands on
 * (SQLite keeps no key names, so a recorded key is told there by its column), else the plugin whose
 * table it is on, by the compiled schema or the owner record, which outlives the configuration that
 * named the plugin. `null` where none says.
 */
function ownerOfKey(
  key: KeyInto,
  known: readonly ElementOnTable[],
  schema: ExtensionSchemaRecord | null,
  recorded: ReadonlyMap<string, SchemaOwner>
): SchemaOwner | null {
  const lower = (name: string) => fold(name);
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
  const table = schema?.owners.get(key.table) ?? recorded.get(fold(key.table));
  return (
    named?.owner ?? column?.owner ?? (table?.kind === "plugin" ? table : null)
  );
}

/** Whether the change removes the key's own table, or every column it is on. */
function goesWithItsColumns(key: KeyInto, removal: Removal): boolean {
  const at = removedTableOf(removal.spellings, key.table);
  if (at === undefined) return false;
  if (removal.tablesRemoved.has(at)) return true;
  const removed = removal.columnsRemoved.get(at);
  return (
    removed !== undefined &&
    key.columns.length > 0 &&
    key.columns.every(column => removed.has(fold(column)))
  );
}

/** An owner as the refusal's log names it; a key whose owner nothing says is unknown. */
function ownerWords(owner: SchemaOwner | null): string {
  return owner === null ? "unknown" : describeOwner(owner);
}

/**
 * The field of `fields` whose column is `column`, as the entity's builder names its columns: the
 * one answer every check names a removed column's field by, on the entity's table or its
 * per-language table, which names its columns the same way.
 */
export function fieldOfColumn(
  fields: readonly FieldDefinition[],
  column: string,
  dialect: SupportedDialect,
  builtBy: Parameters<typeof getColumnDescriptor>[2]
): string | undefined {
  const wanted = fold(column);
  return fieldsStoredOnRow(fields).find(
    field =>
      fold(
        getColumnDescriptor(field, dialect, builtBy)?.name ??
          toSnakeCase(field.name)
      ) === wanted
  )?.name;
}

/**
 * Refuse, before any statement of a change, what the reconcile of its per-language table would drop
 * where another owner built on it: a removed field's per-language column, or the table itself. The
 * reconcile runs once the entity's own table has changed, so its plan's statements are judged here,
 * read as the data-loss consent reads a file's (`fileDeletions`). One judgement for collections,
 * Singles and field groups, each passing the plan its own reconcile runs.
 */
export async function refuseCompanionPlanTakingOthersElements(args: {
  adapter: RecordedElementsAdapter;
  /** The plan the reconcile runs: its statements, in the order it runs them. */
  plan: {
    readonly beforeMain?: readonly string[];
    readonly statements: readonly string[];
  };
  /** The entity the refusal names, and whose field columns the plan drops. */
  kind: "collection" | "single" | "fieldGroup";
  slug: string;
  /** The entity's fields before the change, which name the columns the plan drops. */
  oldFields: readonly FieldDefinition[];
}): Promise<void> {
  const statements = [...(args.plan.beforeMain ?? []), ...args.plan.statements];
  if (statements.length === 0) return;
  const dialect = args.adapter.dialect;
  const db = args.adapter.getDrizzle();
  const [{ fileDeletions, readDeletionFacts }, { entityLabel }] =
    await Promise.all([
      import("../migrate/file-deletions"),
      import("../value-conversion/type-change/field-type-changes"),
    ]);
  await refuseRemovingOthersElements({
    deletions: fileDeletions(
      statements,
      dialect,
      await readDeletionFacts(db, dialect, statements)
    ),
    dialect,
    entity: entityLabel(args.kind, args.slug),
    sources: databaseRemovedElementsSources(args.adapter, dialect),
    fieldOf: (_table, column) =>
      column === undefined
        ? undefined
        : fieldOfColumn(
            args.oldFields,
            column,
            dialect,
            args.kind === "fieldGroup" ? "fieldGroup" : "collection"
          ),
  });
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

/**
 * An index's columns, as the database has the index: what a drop takes is the live index, whatever
 * its owner now declares. One the database no longer has stands on nothing. One it has but does not
 * describe by whole columns (a prefix or an expression) is told by the compiled schema where that
 * declares its columns, and is otherwise unknown.
 */
async function indexColumns(
  element: ElementOnTable,
  schema: ExtensionSchemaRecord | null,
  sources: RemovedElementsSources
): Promise<readonly string[] | "unknown"> {
  const name = fold(element.name);
  const found = await sources.indexColumns(element.table);
  const live =
    found.get(element.name) ??
    [...found].find(([index]) => fold(index) === name)?.[1];
  if (live !== undefined) return live;
  const there = [...(await sources.indexNames(element.table))].some(
    index => fold(index) === name
  );
  if (!there) return [];
  const { resolveIndexName } = await import("../extension/compile");
  const declared = (schema?.entityIndexes.get(element.table) ?? []).find(
    index => fold(resolveIndexName(element.table, index)) === name
  );
  return declared !== undefined && declared.expression === undefined
    ? declared.columns
    : "unknown";
}

/**
 * A foreign key's columns, as the database has the key: the catalog's columns that carry a key of
 * its name, and none where PostgreSQL or MySQL no longer has it. SQLite keeps no constraint names,
 * so there it is the compiled schema's declaration, else, where a removed column carries a key, one
 * that may be this one, whose columns are unknown.
 */
async function foreignKeyColumns(
  element: ElementOnTable,
  schema: ExtensionSchemaRecord | null,
  sources: RemovedElementsSources,
  dialect: SupportedDialect,
  removed: ReadonlySet<string>
): Promise<readonly string[] | "unknown"> {
  const name = fold(element.name);
  const keys = [...(await sources.foreignKeyColumns(element.table))];
  const on = keys
    .filter(([, names]) => names.some(each => fold(each) === name))
    .map(([column]) => column);
  if (on.length > 0 || dialect !== "sqlite") return on;
  const declared = schema?.specs
    .find(spec => fold(spec.name) === fold(element.table))
    ?.foreignKeys?.find(key => fold(key.name) === name);
  if (declared !== undefined) return declared.columns;
  return keys.some(([column]) => removed.has(fold(column))) ? "unknown" : [];
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
