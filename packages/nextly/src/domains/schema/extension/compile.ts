/**
 * The one path from a neutral table to the two shapes consumers need.
 *
 * A `TableSpec` is what the diff engine compares, and a Drizzle table is what
 * the runtime registry queries through and what drizzle-kit pushes. Both are
 * derived HERE, from the same column, so they cannot disagree — and neither
 * re-renders a dialect type of its own: `renderDialectType` already answers
 * that question for collection fields, and an extension column asks the same
 * function rather than a second copy of it.
 *
 * ## Indexes live on the spec, never on the Drizzle table
 *
 * Verified against how the pipeline already works: `index-restore.ts` and
 * `stripKitDropsOfDeclaredIndexes` both rely on the Drizzle tables handed to
 * drizzle-kit carrying NO indexes, because `add_index` is replayed separately.
 * Declaring indexes on the kit tables would make drizzle-kit emit its own
 * `CREATE INDEX` as well, and MySQL has no `IF NOT EXISTS`, so the duplicate
 * key name aborts the whole apply.
 *
 * @module domains/schema/extension/compile
 * @since 1.0.0
 */
import { mysqlTable } from "drizzle-orm/mysql-core";
import { pgTable } from "drizzle-orm/pg-core";
import { check, foreignKey, sqliteTable } from "drizzle-orm/sqlite-core";
import { sql as drizzleSql } from "drizzle-orm";

import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import { currentTimestampSql } from "../../../lib/system-columns";
import { isManagedIndexName } from "../pipeline/diff/index-util";
import type { ColumnSpec, IndexSpec, TableSpec } from "../pipeline/diff/types";
import type { ColumnDescriptor } from "../services/field-column-descriptor";
import { renderDialectType } from "../services/field-column-descriptor";
import { indexNameForColumns } from "../services/index-name";
import { buildUserDrizzleColumn } from "../services/runtime-schema-generator";

import type { ExtensionColumn, ExtensionIndex, ExtensionTable } from "./types";

function invalid(path: string, message: string): never {
  throw NextlyError.validation({
    errors: [{ path, code: "INVALID", message }],
  });
}

/** The descriptor an extension column becomes, so it renders like any other. */
export function toColumnDescriptor(
  column: ExtensionColumn,
  dialect: SupportedDialect
): ColumnDescriptor {
  return {
    name: column.name,
    dialectType: renderDialectType(column.kind, dialect, {
      ...(column.length !== undefined ? { length: column.length } : {}),
      ...(column.precision !== undefined
        ? { precision: column.precision }
        : {}),
      ...(column.scale !== undefined ? { scale: column.scale } : {}),
    }),
    nullable: column.nullable,
    kind: column.kind,
    ...(column.length !== undefined ? { length: column.length } : {}),
    ...(column.precision !== undefined ? { precision: column.precision } : {}),
    ...(column.scale !== undefined ? { scale: column.scale } : {}),
  };
}

/**
 * The DDL default for a column, or undefined.
 *
 * A token is rendered per dialect through the SAME helper the core system
 * columns use, so `created_at` on a plugin table and `created_at` on a core
 * table carry one spelling. Two spellings would read to the diff as a default
 * change on every single apply.
 */
function defaultSql(
  column: ExtensionColumn,
  dialect: SupportedDialect
): string | undefined {
  const value = column.default;
  if (value === undefined) return undefined;
  // The tagged token, which is why it is tagged: a text column may hold the
  // literal string "now", and that must render as a quoted value.
  if (typeof value === "object") return currentTimestampSql(dialect);
  if (typeof value === "string") return `'${value}'`;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** One index's name, derived rather than invented. */
export function resolveIndexName(table: string, index: ExtensionIndex): string {
  if (index.name === undefined) {
    return indexNameForColumns(table, index.columns, index.unique);
  }
  // Asked of the diff engine's own rule rather than restated: `diffIndexes`
  // drops and re-creates exactly the names `isManagedIndexName` accepts, so a
  // second list here could accept a name the diff would then ignore forever.
  if (!isManagedIndexName(index.name)) {
    invalid(
      `${table}.indexes[${index.columns.join(",")}]`,
      `An explicit index name must start with "idx_" or "uq_"; "${index.name}" would never be reconciled by the diff engine.`
    );
  }
  return index.name;
}

/** The spec the diff engine compares against a live table. */
export function toTableSpec(
  table: ExtensionTable,
  dialect: SupportedDialect
): TableSpec {
  const columns: ColumnSpec[] = table.columns.map(column => {
    const descriptor = toColumnDescriptor(column, dialect);
    const rendered = defaultSql(column, dialect);
    return {
      name: descriptor.name,
      type: descriptor.dialectType,
      nullable: descriptor.nullable,
      ...(rendered !== undefined ? { default: rendered } : {}),
      ...(column.primaryKey === true ? { primaryKey: true as const } : {}),
    };
  });

  const indexes: IndexSpec[] = table.indexes.map(index => ({
    name: resolveIndexName(table.name, index),
    columns: [...index.columns],
    unique: index.unique,
    ...(index.where !== undefined ? { where: index.where } : {}),
    ...(index.expression !== undefined ? { expression: index.expression } : {}),
  }));
  // Names derive HERE, from the FINAL table name: live introspection derives
  // from the same name, and a name derived earlier (pre-prefix) could never
  // match the live side — the diff would propose a drop-plus-add on every
  // comparison. An explicit name always wins.
  const foreignKeys = table.foreignKeys?.map(fk => ({
    ...fk,
    name: fk.name ?? `fk_${table.name}_${fk.columns.join("_")}`,
  }));
  const checks = table.checks?.map(ck => ({
    name: `ck_${table.name}_${ck.name}`,
    sql: ck.sql,
  }));

  return {
    name: table.name,
    columns,
    indexes,
    ...(foreignKeys !== undefined ? { foreignKeys } : {}),
    ...(checks !== undefined ? { checks } : {}),
  };
}

/**
 * The Drizzle table the runtime queries through.
 *
 * Columns only — see the module note on why indexes must not appear here.
 */
export function toDrizzleTable(
  table: ExtensionTable,
  dialect: SupportedDialect,
  /**
   * Resolves a referenced table's drizzle object, for foreign keys on the
   * SQLite kit table. A single-table compile cannot build these — the drizzle
   * form of a foreign key needs the REFERENCED table's column objects — so
   * the bundle assembly passes a resolver over its pass-one tables. Absent,
   * or naming a table outside the bundle, the foreign key is skipped on the
   * kit table (it still reaches the statement path, where SQLite refuses
   * in-place edits).
   */
  resolveReferenceTable?: (tableName: string) => unknown
): unknown {
  const columns: Record<string, unknown> = {};
  for (const column of table.columns) {
    columns[column.name] = buildUserDrizzleColumn(
      toColumnDescriptor(column, dialect),
      dialect
    );
  }

  if (dialect === "postgresql") {
    return pgTable(table.name, columns as never);
  }
  if (dialect === "mysql") {
    return mysqlTable(table.name, columns as never);
  }
  const extras: unknown[] = [];
  for (const declared of table.checks ?? []) {
    extras.push(
      check(`ck_${table.name}_${declared.name}`, drizzleSql.raw(declared.sql))
    );
  }
  for (const fk of table.foreignKeys ?? []) {
    const referenced =
      resolveReferenceTable === undefined
        ? undefined
        : (resolveReferenceTable(fk.referencesTable) as Record<
            string,
            unknown
          > | undefined);
    if (referenced === undefined) continue;
    const localColumns = fk.columns.map(name => columns[name]);
    const foreignColumns = fk.referencesColumns.map(
      name => referenced[name]
    );
    if (localColumns.includes(undefined) || foreignColumns.includes(undefined))
      continue;
    // Actions are builder-chained in drizzle rc.4 — the config-object form
    // accepts only name/columns, which the cast would have hidden.
    extras.push(
      foreignKey({
        name: fk.name ?? `fk_${table.name}_${fk.columns.join("_")}`,
        columns: localColumns,
        foreignColumns,
      } as never)
        .onDelete(fk.onDelete)
        .onUpdate(fk.onUpdate)
    );
  }
  return extras.length > 0
    ? sqliteTable(table.name, columns as never, (() => extras) as never)
    : sqliteTable(table.name, columns as never);
}
