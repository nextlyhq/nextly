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
import {
  getColumns,
  getTableName,
  inArray,
  is,
  sql,
  Table,
  type Column,
  type SQL,
} from "drizzle-orm";

import { getDialectTables } from "../../database/index";
import { resolveRelations } from "../../database/resolve-relations";
import { NextlyError } from "../../errors";

import {
  jsonSlugColumns,
  renamedSlugColumns,
  type EndingSlugColumn,
  type FollowingSlugColumn,
  type JsonSlugColumn,
  type SlugDerivedColumns,
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
 *
 * Refuses too, with a VALIDATION_ERROR, a new slug wider than a column it
 * would be written to (`permissions.resource` holds 50 characters), by the
 * narrowest width any dialect declares, so a rename one database would take
 * is refused by every one alike rather than by some of them part-way.
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
    .map(column => ({ column, ...declaredTable(dialect, column) }));

  for (const { column } of columns) {
    if (column.onRename === "follow") {
      refuseTooWide(column.table, column.slugColumn, move.to, move);
    }
  }
  for (const { column, properties } of columns) {
    if (column.onRename === "follow") {
      await refuseTakenSlug(tx, column, properties, move);
    }
    if (column.onRename === "follow-json") {
      await refuseNamedInJson(tx, column, properties, move);
    }
  }
  for (const { column, properties, table } of columns) {
    switch (column.onRename) {
      case "follow":
        await followRename(tx, { dialect, table, properties }, column, move);
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

/** A declared table as the rename writes it: its Drizzle table and names. */
interface DeclaredTable {
  table: Table;
  /**
   * The property names of its columns: the adapter's reads and conditions
   * address columns by property, and the declarations by SQL name, which is
   * what the schema says.
   */
  properties: ColumnProperties;
}

/** The dialect's Drizzle table named `name`, if the schema has one. */
function drizzleTable(
  dialect: SupportedDialect,
  name: string
): Table | undefined {
  const bundle: Record<string, unknown> = getDialectTables(dialect);
  return Object.values(bundle).find(
    (value): value is Table => is(value, Table) && getTableName(value) === name
  );
}

/** A declared table, read from the dialect's Drizzle schema. */
function declaredTable(
  dialect: SupportedDialect,
  column: WrittenColumn
): DeclaredTable {
  const table = drizzleTable(dialect, column.table);
  if (table === undefined) {
    throw NextlyError.internal({
      logContext: {
        reason: "slug-keyed-table-not-in-schema",
        table: column.table,
        dialect,
      },
    });
  }
  return {
    table,
    properties: new Map(
      Object.entries(getColumns(table)).map(([property, sqlColumn]) => [
        sqlColumn.name,
        property,
      ])
    ),
  };
}

const DIALECTS: readonly SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/**
 * The narrowest width any dialect's schema declares for a column, or
 * undefined where every dialect leaves it open.
 */
function narrowestWidth(table: string, sqlName: string): number | undefined {
  const widths = DIALECTS.flatMap(dialect => {
    const declared = drizzleTable(dialect, table);
    if (declared === undefined) return [];
    const sqlColumn = Object.values(getColumns(declared)).find(
      candidate => candidate.name === sqlName
    );
    const length: unknown =
      sqlColumn !== undefined && "length" in sqlColumn
        ? sqlColumn.length
        : undefined;
    return typeof length === "number" ? [length] : [];
  });
  return widths.length === 0 ? undefined : Math.min(...widths);
}

/**
 * Refuse a rename that would write `value` (the new slug, or a value made
 * from it) into a column too narrow for it on some dialect. The answer names
 * the longest slug that would fit.
 */
function refuseTooWide(
  table: string,
  sqlName: string,
  value: string,
  move: EntitySlugMove
): void {
  const width = narrowestWidth(table, sqlName);
  if (width === undefined || value.length <= width) return;
  const longest = width - (value.length - move.to.length);
  throw NextlyError.validation({
    errors: [
      {
        path: "slug",
        code: "TOO_LONG",
        message: `Must be at most ${longest} characters.`,
      },
    ],
    logContext: {
      reason: "rename-target-too-wide",
      table,
      column: sqlName,
      width,
      kind: move.kind,
      slug: move.to,
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
 * Bound parameters one batched statement may carry: under the 999 SQLite
 * allows, and far under PostgreSQL's and MySQL's limits.
 */
const STATEMENT_PARAMETERS = 900;

/** The part of a Drizzle handle a batched update needs. */
interface UpdatingDb {
  update(table: Table): {
    set(values: Record<string, unknown>): {
      where(condition: SQL): Promise<unknown>;
    };
  };
}

/** One row's id and the derived values the declaration made for it. */
interface DerivedRow {
  id: SqlParam;
  values: Readonly<Record<string, unknown>>;
}

/**
 * Move one table's rows to the new slug. Rows with columns derived from the
 * slug have them derived again, by the function every writer of the table
 * uses, rather than by the database; the rest move in one statement.
 */
async function followRename(
  tx: TransactionContext,
  declared: DeclaredTable & { dialect: SupportedDialect },
  column: FollowingSlugColumn,
  move: EntitySlugMove
): Promise<void> {
  const { properties } = declared;
  const slugProperty = property(properties, column, column.slugColumn);
  const derived = column.derived;
  if (derived !== undefined) {
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
    const derivedRows = rows.map((raw): DerivedRow => {
      const row: SlugKeyedRow = Object.fromEntries(
        read.map(name => [name, raw[property(properties, column, name)]])
      );
      const values = derived.derive(row, move.to, move.from);
      for (const [name, value] of Object.entries(values)) {
        if (typeof value === "string") {
          refuseTooWide(column.table, name, value, move);
        }
      }
      return { id: rowIdOf(column, row[derived.rowId]), values };
    });
    await writeDerived(tx, declared, column, derivedRows, move);
  }
  await tx.update(
    column.table,
    { [slugProperty]: move.to },
    entityWhere(properties, column, move.kind, move.from)
  );
}

/**
 * Write the derived rows' new slug and values. Rows are written many to a
 * statement, each column's value chosen per row by id, so a table with a row
 * per person and document moves in a bounded number of statements rather than
 * one per row.
 *
 * A JSON column is the exception: the value chosen per row is a bound
 * parameter, which PostgreSQL types as text and will not assign to `jsonb`,
 * so rows deriving one are written one statement each. The one such
 * declaration, events not yet fanned out, holds only what the delivery drain
 * has yet to reach.
 */
async function writeDerived(
  tx: TransactionContext,
  declared: DeclaredTable & { dialect: SupportedDialect },
  column: FollowingSlugColumn,
  rows: readonly DerivedRow[],
  move: EntitySlugMove
): Promise<void> {
  const derived = column.derived;
  if (derived === undefined || rows.length === 0) return;
  const target: DerivedTarget = {
    ...declared,
    column,
    derived,
    sqlColumns: columnsBySqlName(declared.table),
  };
  const writesJson = derived.columns.some(name =>
    target.sqlColumns.get(name)?.dataType.split(" ").includes("json")
  );
  if (writesJson) {
    await writeDerivedEach(tx, target, rows, move);
  } else {
    await writeDerivedBatched(tx, target, rows, move);
  }
}

/** Where derived rows are written: the declared table and its declaration. */
interface DerivedTarget extends DeclaredTable {
  dialect: SupportedDialect;
  column: FollowingSlugColumn;
  derived: SlugDerivedColumns;
  sqlColumns: ReadonlyMap<string, Column>;
}

/** A table's Drizzle columns, by SQL name. */
function columnsBySqlName(table: Table): ReadonlyMap<string, Column> {
  return new Map(
    Object.values(getColumns(table)).map(sqlColumn => [
      sqlColumn.name,
      sqlColumn,
    ])
  );
}

/** Write each derived row in a statement of its own. */
async function writeDerivedEach(
  tx: TransactionContext,
  { properties, column, derived }: DerivedTarget,
  rows: readonly DerivedRow[],
  move: EntitySlugMove
): Promise<void> {
  const rowIdProperty = property(properties, column, derived.rowId);
  for (const row of rows) {
    await tx.update(
      column.table,
      {
        [property(properties, column, column.slugColumn)]: move.to,
        // Only the columns the declaration derived again: one it left out
        // holds a value someone chose, and keeps it.
        ...Object.fromEntries(
          derived.columns
            .filter(name => name in row.values)
            .map(name => [property(properties, column, name), row.values[name]])
        ),
      },
      { and: [{ column: rowIdProperty, op: "=", value: row.id }] }
    );
  }
}

/** A table's id column, refusing a declaration whose table lacks it. */
function rowIdColumn({ column, derived, sqlColumns }: DerivedTarget): Column {
  const rowId = sqlColumns.get(derived.rowId);
  if (rowId === undefined) {
    throw NextlyError.internal({
      logContext: {
        reason: "slug-keyed-column-not-in-table",
        table: column.table,
        column: derived.rowId,
      },
    });
  }
  return rowId;
}

/**
 * One batched statement's assignments: the new slug, and each derived
 * column's value chosen per row by id. A row the declaration left a column
 * out for keeps its value.
 */
function batchAssignments(
  { properties, column, derived, sqlColumns }: DerivedTarget,
  rowId: Column,
  batch: readonly DerivedRow[],
  move: EntitySlugMove
): Record<string, unknown> {
  const values: Record<string, unknown> = {
    [property(properties, column, column.slugColumn)]: move.to,
  };
  for (const name of derived.columns) {
    const sqlColumn = sqlColumns.get(name);
    const chosen = batch.filter(row => name in row.values);
    if (sqlColumn === undefined || chosen.length === 0) continue;
    values[property(properties, column, name)] = sql`CASE ${rowId} ${sql.join(
      chosen.map(row => sql`WHEN ${row.id} THEN ${row.values[name]}`),
      sql` `
    )} ELSE ${sqlColumn} END`;
  }
  return values;
}

/** Write the derived rows many to a statement. */
async function writeDerivedBatched(
  tx: TransactionContext,
  target: DerivedTarget,
  rows: readonly DerivedRow[],
  move: EntitySlugMove
): Promise<void> {
  const rowId = rowIdColumn(target);
  const db = tx.drizzleWithRelations<UpdatingDb>(
    resolveRelations(target.dialect)
  );
  // Each row binds its id once for the condition, and an id and a value for
  // each derived column.
  const perStatement = Math.floor(
    STATEMENT_PARAMETERS / (1 + 2 * target.derived.columns.length)
  );
  for (let at = 0; at < rows.length; at += perStatement) {
    const batch = rows.slice(at, at + perStatement);
    await db
      .update(target.table)
      .set(batchAssignments(target, rowId, batch, move))
      .where(
        inArray(
          rowId,
          batch.map(row => row.id)
        )
      );
  }
}

/**
 * Delete one table's rows for the old slug and for the new one. The new
 * slug names no live entity of this kind (the registry refuses a rename onto
 * one), so rows under it are an earlier entity's: a lease, a link or a kept
 * answer that would otherwise apply to the renamed entity the moment it takes
 * the name.
 */
async function endOnRename(
  tx: TransactionContext,
  column: EndingSlugColumn,
  properties: ColumnProperties,
  move: EntitySlugMove
): Promise<void> {
  for (const slug of [move.from, move.to]) {
    await tx.delete(
      column.table,
      entityWhere(properties, column, move.kind, slug)
    );
  }
}

/**
 * Every row's id and JSON value, for a table declared small enough to read,
 * leaving out the rows its declaration excludes.
 */
async function jsonRows(
  tx: TransactionContext,
  column: JsonSlugColumn,
  properties: ColumnProperties
): Promise<{ id: SqlParam; value: unknown }[]> {
  const idProperty = property(properties, column, column.rowId);
  const valueProperty = property(properties, column, column.jsonColumn);
  const excluded = (column.onlyWhereNull ?? []).map(name => ({
    column: property(properties, column, name),
    op: "IS NULL" as const,
  }));
  const rows = await tx.select<Record<string, unknown>>(column.table, {
    columns: [idProperty, valueProperty],
    ...(excluded.length > 0 ? { where: { and: excluded } } : {}),
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
