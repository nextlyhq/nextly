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
import { sql as drizzleSql } from "drizzle-orm";
import { mysqlTable } from "drizzle-orm/mysql-core";
import { pgTable } from "drizzle-orm/pg-core";
import { check, foreignKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import { currentTimestampSql } from "../../../lib/system-columns";
import { isManagedIndexName } from "../pipeline/diff/index-util";
import type { ColumnSpec, IndexSpec, TableSpec } from "../pipeline/diff/types";
import { indexNameForColumns } from "../services/index-name";
import { buildUserDrizzleColumn } from "../services/runtime-schema-generator";
import { quoteJsonSqlDefault, quoteSqlLiteral } from "../utils/sql-literal";

import { toColumnDescriptor } from "./column-descriptor";
import { enumChecks } from "./enum-check";
import type { ExtensionColumn, ExtensionIndex, ExtensionTable } from "./types";

function invalid(path: string, message: string): never {
  throw NextlyError.validation({
    errors: [{ path, code: "INVALID", message }],
  });
}

// Re-exported so every existing consumer keeps its import; it lives in its
// own module to keep this file off the runtime generator's import path.
export { toColumnDescriptor } from "./column-descriptor";

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
  if (typeof value === "string") {
    // Through the shared quoter, never `'${value}'`. DDL is assembled as text
    // before it reaches the driver, so an apostrophe — `O'Reilly` — closed the
    // quote early and produced a migration that could not parse on any dialect.
    // The helper also doubles backslashes for MySQL, which reads one as an
    // escape introducer where the others store it verbatim; a JSON default
    // would otherwise come back with a real newline in it and stop being JSON.
    return column.kind === "json"
      ? quoteJsonSqlDefault(value, dialect)
      : quoteSqlLiteral(value, dialect);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * A column on a table this function did not compile, found by SQL name.
 *
 * The referenced table may be keyed either way: a core table's properties are
 * SQL-named, while an extension table's are the authored keys. Reading
 * `referenced[sqlName]` therefore returned undefined whenever the target was
 * an extension table with a camelCase column — and the caller SKIPS a foreign
 * key whose columns do not resolve, so the constraint silently did not exist.
 *
 * The direct hit is tried first because it is the common case; the scan asks
 * each column what it is actually called, which is the question that has one
 * answer regardless of how the record was keyed.
 */
function referencedColumn(
  referenced: Record<string, unknown>,
  sqlName: string
): unknown {
  const direct = referenced[sqlName];
  if (direct !== undefined) return direct;
  for (const value of Object.values(referenced)) {
    if (
      value !== null &&
      typeof value === "object" &&
      (value as { name?: unknown }).name === sqlName
    ) {
      return value;
    }
  }
  return undefined;
}

/**
 * The authored key a SQL column name belongs to, or the name itself.
 *
 * The fallback matters for a reference to a table this function did not
 * compile — a core table, say — whose properties are already SQL-named.
 */
export function authoredKeyOf(table: ExtensionTable, sqlName: string): string {
  return table.columns.find(column => column.name === sqlName)?.key ?? sqlName;
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
/**
 * One extension column as the diff engine compares it.
 *
 * Extracted from {@link toTableSpec} because a column contributed to a table
 * this module does NOT own — an entity or an extendable core table — has to
 * reach that table's desired spec by a different route, and rendering it a
 * second time is how the two descriptions drift. A contributed column
 * described even slightly differently from a declared one makes the diff
 * propose add-and-drop pairs that never converge.
 */
export function toColumnSpec(
  column: ExtensionColumn,
  dialect: SupportedDialect
): ColumnSpec {
  const descriptor = toColumnDescriptor(column, dialect);
  const rendered = defaultSql(column, dialect);
  return {
    name: descriptor.name,
    type: descriptor.dialectType,
    nullable: descriptor.nullable,
    ...(rendered !== undefined ? { default: rendered } : {}),
    ...(column.primaryKey === true ? { primaryKey: true as const } : {}),
    // The generation semantics `type` deliberately does not carry: it holds
    // the INTROSPECTED type so the diff compares equal, which leaves the
    // rendered DDL with no sequence and no AUTO_INCREMENT unless the spec says
    // so separately.
    ...(column.kind === "serial" ? { autoIncrement: true as const } : {}),
  };
}

export function toTableSpec(
  table: ExtensionTable,
  dialect: SupportedDialect
): TableSpec {
  const columns: ColumnSpec[] = table.columns.map(column =>
    toColumnSpec(column, dialect)
  );

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
  // Declared checks, plus the one each enum column implies. Concatenated
  // rather than kept apart because they are the same thing to everything
  // downstream: the diff compares checks by name, and an enum's constraint is
  // a check whose expression the author did not have to write.
  const declared =
    table.checks?.map(ck => ({
      name: `ck_${table.name}_${ck.name}`,
      sql: ck.sql,
    })) ?? [];
  const fromEnums = enumChecks(table.name, table.columns, dialect);
  const checks =
    declared.length + fromEnums.length > 0
      ? [...declared, ...fromEnums]
      : undefined;

  return {
    name: table.name,
    columns,
    indexes,
    ...(foreignKeys !== undefined ? { foreignKeys } : {}),
    ...(checks !== undefined ? { checks } : {}),
  };
}

/**
 * A stand-in for a table this compile did not build, carrying only what a
 * foreign key needs from it: the table's name and the referenced columns'.
 *
 * SQLite takes a foreign key in `CREATE TABLE` or not at all, and Drizzle's
 * form of one needs the REFERENCED table's column objects. For a table outside
 * the extension bundle — core, entity, adopted — those objects either live in
 * a registry that boot has not built yet when the extension schema compiles,
 * or (for an entity) are built from fields this compile never sees. Resolving
 * them was therefore order-dependent, and a miss dropped the constraint
 * silently.
 *
 * The declaration already names the table and its columns, and that is all
 * the DDL reads: `REFERENCES <table>(<columns>)`. The column type is not part
 * of a foreign key clause, so the stand-in's is arbitrary. Never registered
 * or queried — it exists only inside the constraint that points at it.
 */
export function referenceTableStub(
  tableName: string,
  columns: readonly string[]
): unknown {
  const stubColumns: Record<string, unknown> = {};
  for (const name of columns) {
    stubColumns[name] = text(name);
  }
  return sqliteTable(tableName, stubColumns as never);
}

/**
 * A built column with the key and default its declaration carries.
 *
 * Both belong to the table the push creates rather than to statements added
 * after it, and nothing adds them later: left off, a fresh database had no
 * primary key on any dialect — so every foreign key pointing at the table was
 * refused for want of a unique target — and an insert omitting a defaulted
 * column failed NOT NULL. The default is the spec's own rendering, the text
 * the diff compares, so the table created here and the one the diff expects
 * are the same table.
 */
function withDeclaredKeyAndDefault(
  built: unknown,
  column: ExtensionColumn,
  dialect: SupportedDialect
): unknown {
  let result = built as DrizzleColumnBuilder;
  const rendered = defaultSql(column, dialect);
  if (rendered !== undefined) {
    result = result.default(drizzleSql.raw(rendered)) as DrizzleColumnBuilder;
  }
  return column.primaryKey === true ? result.primaryKey() : result;
}

/** The two modifiers every dialect's column builder offers. */
interface DrizzleColumnBuilder {
  primaryKey(): unknown;
  default(value: unknown): unknown;
}

/**
 * The Drizzle table the runtime queries through.
 *
 * Columns, with their key and defaults. No indexes — see the module note — and
 * checks and foreign keys only on SQLite, which accepts them nowhere but
 * CREATE TABLE; the other dialects add them with statements of their own.
 */
export function toDrizzleTable(
  table: ExtensionTable,
  dialect: SupportedDialect,
  /**
   * Resolves a referenced table's drizzle object, for foreign keys on the
   * SQLite kit table. A single-table compile cannot build these — the drizzle
   * form of a foreign key needs the REFERENCED table's column objects — so
   * the bundle assembly passes a resolver: its own pass-one tables, and a
   * `referenceTableStub` for any table outside the bundle. Absent, foreign
   * keys are left off the kit table, which is what pass one wants.
   */
  resolveReferenceTable?: (
    tableName: string,
    columns: readonly string[]
  ) => unknown
): unknown {
  // Keyed by the AUTHORED key, named by the SQL one.
  //
  // Drizzle's record key is the JavaScript property and the builder's argument
  // is the column name, so `{ providerAccountId: varchar("provider_account_id") }`
  // carries both. Keying by the SQL name instead made `InferRow` and
  // `TableColumns` describe a shape that did not exist:
  // `ctx.db.table(definition).providerAccountId` was undefined, and `select()`
  // returned snake_case keys while typed as camelCase — so the typed surface
  // was wrong for every table whose columns are not already snake_case.
  const columns: Record<string, unknown> = {};
  for (const column of table.columns) {
    columns[column.key] = withDeclaredKeyAndDefault(
      buildUserDrizzleColumn(toColumnDescriptor(column, dialect), dialect),
      column,
      dialect
    );
  }

  if (dialect === "postgresql") {
    return pgTable(table.name, columns as never);
  }
  if (dialect === "mysql") {
    return mysqlTable(table.name, columns as never);
  }
  // Every check the spec carries — the declared ones and the one each
  // `col.enum()` implies — from the spec itself, so the names and the SQL are
  // the ones the diff compares against. Taking only the declared checks left
  // an enum unenforced on SQLite, which has no later chance to add it.
  const checks = (toTableSpec(table, dialect).checks ?? []).map(spec =>
    check(spec.name, drizzleSql.raw(spec.sql))
  );
  const foreignKeys: {
    name: string;
    localKeys: string[];
    foreignColumns: unknown[];
    onDelete: NonNullable<ExtensionTable["foreignKeys"]>[number]["onDelete"];
    onUpdate: NonNullable<ExtensionTable["foreignKeys"]>[number]["onUpdate"];
  }[] = [];
  for (const fk of table.foreignKeys ?? []) {
    const referenced =
      resolveReferenceTable === undefined
        ? undefined
        : (resolveReferenceTable(fk.referencesTable, fk.referencesColumns) as
            | Record<string, unknown>
            | undefined);
    if (referenced === undefined) continue;
    // A foreign key names SQL columns, and the records are keyed by authored
    // key — so the name is translated before the lookup. Reading `columns[name]`
    // directly returned undefined and the key was silently skipped, which is
    // worse than failing: the constraint simply would not exist.
    const localKeys = fk.columns.map(name => authoredKeyOf(table, name));
    const foreignColumns = fk.referencesColumns.map(name =>
      referencedColumn(referenced, name)
    );
    if (
      localKeys.some(key => columns[key] === undefined) ||
      foreignColumns.includes(undefined)
    )
      continue;
    foreignKeys.push({
      name: fk.name ?? `fk_${table.name}_${fk.columns.join("_")}`,
      localKeys,
      foreignColumns,
      onDelete: fk.onDelete,
      onUpdate: fk.onUpdate,
    });
  }
  if (checks.length === 0 && foreignKeys.length === 0) {
    return sqliteTable(table.name, columns as never);
  }
  // The local side of a foreign key is read from the BUILT columns Drizzle
  // hands this callback, not from the builders in `columns`. A builder has no
  // `name` until its table is built, so a constraint made from one reported
  // its own columns as undefined to everything that renders it.
  return sqliteTable(
    table.name,
    columns as never,
    ((built: Record<string, unknown>) => [
      ...checks,
      // Actions are builder-chained in drizzle rc.4 — the config-object form
      // accepts only name/columns, which the cast would have hidden.
      ...foreignKeys.map(fk =>
        foreignKey({
          name: fk.name,
          columns: fk.localKeys.map(key => built[key]),
          foreignColumns: fk.foreignColumns,
        } as never)
          .onDelete(fk.onDelete)
          .onUpdate(fk.onUpdate)
      ),
    ]) as never
  );
}
