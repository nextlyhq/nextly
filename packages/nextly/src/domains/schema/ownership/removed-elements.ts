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
 * An element another owner keeps elsewhere on a table the change keeps does not stop it.
 *
 * @module domains/schema/ownership/removed-elements
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { getActiveExtensionSchema } from "../extension/active-schema";
import type { Deletion } from "../migrate/data-loss-consent";
import type {
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../pipeline/diff/types";
import {
  readForeignKeyColumns,
  readIndexColumns,
} from "../pipeline/live-table-facts";

import {
  describeOwner,
  distinctElements,
  elementsAddedTo,
  readRecordedElementsOn,
  type ElementOnTable,
  type ExtensionSchemaRecord,
  type RecordedElementsAdapter,
} from "./dependent-elements";

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
  element: ElementOnTable;
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
        owner: describeOwner(element.owner),
        kind: element.kind,
        name: element.name,
        table: element.table,
        ...(field === undefined ? {} : { field }),
        ...(column === undefined ? {} : { column }),
      })),
    },
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
  field,
  column,
  unknownColumns,
}: Taken): string {
  const what = `${describeOwner(element.owner)}'s ${element.kind} "${element.name}" on ${element.table}`;
  const by = field === undefined ? "The change" : `Removing "${field}"`;
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
