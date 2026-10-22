/**
 * Move what is keyed by a collection's or Single's slug to its new slug, on
 * the rename's own transaction.
 *
 * The rename writes the registry row and then calls this with the same `tx`,
 * so the registry and every declared table commit together or not at all: a
 * failure anywhere here rolls the registry change back with it. What moves,
 * what is deleted and what stays is for `SLUG_COLUMNS` to say; nothing here
 * names a table.
 *
 * @module domains/entity-rename/move-entity-slug
 */

import type {
  SqlParam,
  SupportedDialect,
  TransactionContext,
  WhereClause,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";
import { getTableColumns, getTableName, is, Table } from "drizzle-orm";

import { getDialectTables } from "../../database/index";
import { NextlyError } from "../../errors";

import {
  jsonSlugColumns,
  renamedSlugColumns,
  type EndingSlugColumn,
  type FollowingSlugColumn,
  type JsonSlugColumn,
  type RenamedEntityKind,
  type RenamedSlugColumn,
  type SlugKeyedRow,
} from "./slug-columns";

/** One rename: which kind of entity, and its slug before and after. */
export interface EntitySlugMove {
  kind: RenamedEntityKind;
  from: string;
  to: string;
}

/** A declared table the rename writes, whichever way it writes it. */
type WrittenColumn = RenamedSlugColumn | JsonSlugColumn;

/** The declared columns the rename writes, in the order it writes them. */
function writtenColumns(): WrittenColumn[] {
  return [...renamedSlugColumns(), ...jsonSlugColumns()];
}

/**
 * The declared tables this database has. A table not created yet holds no
 * rows to move, and the translation archive is created only when it is first
 * needed. Read BEFORE the rename's transaction: on PostgreSQL a statement
 * against a missing table aborts the whole transaction, so it cannot be asked
 * inside one and recovered from.
 */
export async function slugKeyedTablesPresent(db: {
  listTables(): Promise<string[]>;
}): Promise<ReadonlySet<string>> {
  const declared = new Set(writtenColumns().map(column => column.table));
  return new Set((await db.listTables()).filter(name => declared.has(name)));
}

/**
 * Move every declared table's rows for `move.from` to `move.to`, on `tx`.
 *
 * Refuses first, before writing anything, when the new slug is already named
 * by rows of the same kind in a table whose rows follow a rename: those belong
 * to an earlier entity of that name (its history, its permissions, a webhook
 * filter that listed it), and moving this entity's rows in beside them would
 * merge two entities into one. The refusal is a CONFLICT the caller's
 * transaction rolls back with.
 */
export async function moveEntitySlug(
  tx: TransactionContext,
  input: {
    dialect: SupportedDialect;
    present: ReadonlySet<string>;
    move: EntitySlugMove;
  }
): Promise<void> {
  const { dialect, present, move } = input;
  if (move.from === move.to) return;
  const columns = writtenColumns()
    .filter(column => present.has(column.table))
    .filter(
      column =>
        column.onRename !== "follow-json" || column.renames.includes(move.kind)
    )
    .map(column => ({ column, properties: propertiesOf(dialect, column) }));

  for (const { column, properties } of columns) {
    if (column.onRename === "follow") {
      await refuseTakenSlug(tx, column, properties, move);
    }
    if (column.onRename === "follow-json") {
      await refuseNamedInJson(tx, column, properties, move);
    }
  }
  for (const { column, properties } of columns) {
    switch (column.onRename) {
      case "follow":
        await followRename(tx, column, properties, move);
        break;
      case "end":
        await endOnRename(tx, column, properties, move);
        break;
      case "follow-json":
        await rewriteJson(tx, column, properties, move);
        break;
    }
  }
}

/** SQL column name to the Drizzle property the adapter addresses it by. */
type ColumnProperties = ReadonlyMap<string, string>;

/**
 * The property names of a declared table's columns, read from the dialect's
 * Drizzle table: the adapter's reads and conditions address columns by
 * property, and the declarations by SQL name, which is what the schema says.
 */
function propertiesOf(
  dialect: SupportedDialect,
  column: WrittenColumn
): ColumnProperties {
  const bundle: Record<string, unknown> = getDialectTables(dialect);
  for (const value of Object.values(bundle)) {
    if (is(value, Table) && getTableName(value) === column.table) {
      return new Map(
        Object.entries(getTableColumns(value)).map(([property, sqlColumn]) => [
          sqlColumn.name,
          property,
        ])
      );
    }
  }
  throw NextlyError.internal({
    logContext: {
      reason: "slug-keyed-table-not-in-schema",
      table: column.table,
      dialect,
    },
  });
}

/** The property for one SQL column, refusing a declaration the table lacks. */
function property(
  properties: ColumnProperties,
  column: WrittenColumn,
  sqlName: string
): string {
  const found = properties.get(sqlName);
  if (found === undefined) {
    throw NextlyError.internal({
      logContext: {
        reason: "slug-keyed-column-not-in-table",
        table: column.table,
        column: sqlName,
      },
    });
  }
  return found;
}

/**
 * The rows of one entity in a declared table: its kind where the table
 * records one, under `slug`, and only rows that are the entity's own.
 */
function entityWhere(
  properties: ColumnProperties,
  column: RenamedSlugColumn,
  kind: RenamedEntityKind,
  slug: string
): WhereClause {
  const conditions: (WhereCondition | WhereClause)[] = [
    {
      column: property(properties, column, column.slugColumn),
      op: "=",
      value: slug,
    },
    ...(column.onlyWhereNull ?? []).map(name => ({
      column: property(properties, column, name),
      op: "IS NULL" as const,
    })),
  ];
  if (column.kind !== undefined) {
    const kindProperty = property(properties, column, column.kind.column);
    const stored = column.kind.values[kind];
    const named = stored.filter((value): value is string => value !== null);
    conditions.push({
      or: [
        ...(named.length > 0
          ? [{ column: kindProperty, op: "IN" as const, value: named }]
          : []),
        ...(stored.includes(null)
          ? [{ column: kindProperty, op: "IS NULL" as const }]
          : []),
      ],
    });
  }
  return { and: conditions };
}

/** The refusal of a rename onto a slug an earlier entity's rows still name. */
function takenSlug(table: string, move: EntitySlugMove): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message:
      "That name still holds records of an earlier collection or Single (its history, permissions or webhook filters). Choose another name.",
    logContext: {
      reason: "rename-target-holds-history",
      table,
      kind: move.kind,
      slug: move.to,
    },
  });
}

/** Refuse a rename onto a slug whose earlier entity's rows are still here. */
async function refuseTakenSlug(
  tx: TransactionContext,
  column: FollowingSlugColumn,
  properties: ColumnProperties,
  move: EntitySlugMove
): Promise<void> {
  const held = await tx.select(column.table, {
    columns: [property(properties, column, column.slugColumn)],
    where: entityWhere(properties, column, move.kind, move.to),
    limit: 1,
  });
  if (held.length > 0) throw takenSlug(column.table, move);
}

/**
 * Move one table's rows to the new slug. A row with columns derived from the
 * slug is written on its own, with them derived again from its columns; the
 * rest move in one statement.
 *
 * One statement per derived row, because each value is derived here, by the
 * function every writer of the table uses, rather than by the database.
 */
async function followRename(
  tx: TransactionContext,
  column: FollowingSlugColumn,
  properties: ColumnProperties,
  move: EntitySlugMove
): Promise<void> {
  const slugProperty = property(properties, column, column.slugColumn);
  const derived = column.derived;
  if (derived !== undefined) {
    const rowIdProperty = property(properties, column, derived.rowId);
    const read = [
      derived.rowId,
      ...(column.kind ? [column.kind.column] : []),
      ...derived.sources,
    ];
    const rows = await tx.select<Record<string, unknown>>(column.table, {
      columns: read.map(name => property(properties, column, name)),
      where: {
        and: [
          entityWhere(properties, column, move.kind, move.from),
          ...(derived.onlyWhereSet === undefined
            ? []
            : [
                {
                  column: property(properties, column, derived.onlyWhereSet),
                  op: "IS NOT NULL" as const,
                },
              ]),
        ],
      },
    });
    for (const raw of rows) {
      const row: SlugKeyedRow = Object.fromEntries(
        read.map(name => [name, raw[property(properties, column, name)]])
      );
      const values = derived.derive(row, move.to);
      await tx.update(
        column.table,
        {
          [slugProperty]: move.to,
          ...Object.fromEntries(
            derived.columns.map(name => [
              property(properties, column, name),
              values[name],
            ])
          ),
        },
        {
          and: [
            {
              column: rowIdProperty,
              op: "=",
              value: rowIdOf(column, row[derived.rowId]),
            },
          ],
        }
      );
    }
  }
  await tx.update(
    column.table,
    { [slugProperty]: move.to },
    entityWhere(properties, column, move.kind, move.from)
  );
}

/** Delete one table's rows for the old slug. */
async function endOnRename(
  tx: TransactionContext,
  column: EndingSlugColumn,
  properties: ColumnProperties,
  move: EntitySlugMove
): Promise<void> {
  await tx.delete(
    column.table,
    entityWhere(properties, column, move.kind, move.from)
  );
}

/** Every row's id and JSON value, for a table declared small enough to read. */
async function jsonRows(
  tx: TransactionContext,
  column: JsonSlugColumn,
  properties: ColumnProperties
): Promise<{ id: SqlParam; value: unknown }[]> {
  const idProperty = property(properties, column, column.rowId);
  const valueProperty = property(properties, column, column.jsonColumn);
  const rows = await tx.select<Record<string, unknown>>(column.table, {
    columns: [idProperty, valueProperty],
  });
  return rows.map(row => ({
    id: rowIdOf(column, row[idProperty]),
    value: row[valueProperty],
  }));
}

/** Refuse a rename onto a slug a JSON value already names. */
async function refuseNamedInJson(
  tx: TransactionContext,
  column: JsonSlugColumn,
  properties: ColumnProperties,
  move: EntitySlugMove
): Promise<void> {
  const rows = await jsonRows(tx, column, properties);
  if (rows.some(row => column.names(row.value, move.to))) {
    throw takenSlug(column.table, move);
  }
}

/** Rewrite each JSON value that names the old slug to name the new one. */
async function rewriteJson(
  tx: TransactionContext,
  column: JsonSlugColumn,
  properties: ColumnProperties,
  move: EntitySlugMove
): Promise<void> {
  const idProperty = property(properties, column, column.rowId);
  const valueProperty = property(properties, column, column.jsonColumn);
  for (const row of await jsonRows(tx, column, properties)) {
    if (!column.names(row.value, move.from)) continue;
    await tx.update(
      column.table,
      { [valueProperty]: column.rewrite(row.value, move.from, move.to) },
      { and: [{ column: idProperty, op: "=", value: row.id }] }
    );
  }
}

/** A row id as a statement parameter, refusing a row read without one. */
function rowIdOf(column: WrittenColumn, value: unknown): SqlParam {
  if (typeof value === "string" || typeof value === "number") return value;
  throw NextlyError.internal({
    logContext: {
      reason: "slug-keyed-row-missing-id",
      table: column.table,
      valueType: typeof value,
    },
  });
}
