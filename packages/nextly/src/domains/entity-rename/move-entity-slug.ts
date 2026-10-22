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
  renamedSlugColumns,
  type EndingSlugColumn,
  type FollowingSlugColumn,
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
  const declared = new Set(renamedSlugColumns().map(column => column.table));
  return new Set((await db.listTables()).filter(name => declared.has(name)));
}

/**
 * Move every declared table's rows for `move.from` to `move.to`, on `tx`.
 *
 * Refuses first, before writing anything, when the new slug already holds
 * rows of the same kind in a table whose rows follow a rename: those belong
 * to an earlier entity of that name, and moving this entity's rows in beside
 * them would merge two entities' history into one. The refusal is a CONFLICT
 * the caller's transaction rolls back with.
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
  const columns = renamedSlugColumns()
    .filter(column => present.has(column.table))
    .map(column => ({ column, properties: propertiesOf(dialect, column) }));

  for (const { column, properties } of columns) {
    if (column.onRename === "follow") {
      await refuseTakenSlug(tx, column, properties, move);
    }
  }
  for (const { column, properties } of columns) {
    if (column.onRename === "follow") {
      await followRename(tx, column, properties, move);
    } else {
      await endOnRename(tx, column, properties, move);
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
  column: RenamedSlugColumn
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
  column: RenamedSlugColumn,
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

/** The rows of one entity in a declared table: its kind, under `slug`. */
function entityWhere(
  properties: ColumnProperties,
  column: RenamedSlugColumn,
  kind: RenamedEntityKind,
  slug: string
): WhereClause {
  const kindProperty = property(properties, column, column.kindColumn);
  const stored = column.kinds[kind];
  const named = stored.filter((value): value is string => value !== null);
  const kindMatches: WhereCondition[] = [
    ...(named.length > 0
      ? [{ column: kindProperty, op: "IN" as const, value: named }]
      : []),
    ...(stored.includes(null)
      ? [{ column: kindProperty, op: "IS NULL" as const }]
      : []),
  ];
  return {
    and: [
      {
        column: property(properties, column, column.slugColumn),
        op: "=",
        value: slug,
      },
      { or: kindMatches },
    ],
  };
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
  if (held.length === 0) return;
  throw NextlyError.conflict({
    reason: "state",
    message:
      "That name still holds the history of an earlier collection or Single. Choose another name.",
    logContext: {
      reason: "rename-target-holds-history",
      table: column.table,
      kind: move.kind,
      slug: move.to,
    },
  });
}

/**
 * Move one table's rows to the new slug. A row with a key digested from the
 * slug is written on its own, with the key computed again from its columns;
 * the rest move in one statement.
 *
 * One statement per keyed row, because each digest is computed here, by the
 * function every writer of the table uses, rather than by the database.
 */
async function followRename(
  tx: TransactionContext,
  column: FollowingSlugColumn,
  properties: ColumnProperties,
  move: EntitySlugMove
): Promise<void> {
  const slugProperty = property(properties, column, column.slugColumn);
  const key = column.key;
  if (key !== undefined) {
    const keyProperty = property(properties, column, key.column);
    const rowIdProperty = property(properties, column, key.rowId);
    const read = [key.rowId, column.kindColumn, ...key.sources];
    const rows = await tx.select<Record<string, unknown>>(column.table, {
      columns: read.map(name => property(properties, column, name)),
      where: {
        and: [
          entityWhere(properties, column, move.kind, move.from),
          { column: keyProperty, op: "IS NOT NULL" },
        ],
      },
    });
    for (const raw of rows) {
      const row: SlugKeyedRow = Object.fromEntries(
        read.map(name => [name, raw[property(properties, column, name)]])
      );
      await tx.update(
        column.table,
        { [slugProperty]: move.to, [keyProperty]: key.derive(row, move.to) },
        {
          and: [
            {
              column: rowIdProperty,
              op: "=",
              value: rowIdOf(column, row[key.rowId]),
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

/** A row id as a statement parameter, refusing a row read without one. */
function rowIdOf(column: RenamedSlugColumn, value: unknown): SqlParam {
  if (typeof value === "string" || typeof value === "number") return value;
  throw NextlyError.internal({
    logContext: {
      reason: "slug-keyed-row-missing-id",
      table: column.table,
      valueType: typeof value,
    },
  });
}
