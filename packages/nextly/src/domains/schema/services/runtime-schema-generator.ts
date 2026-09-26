/**
 * Runtime Schema Generator
 *
 * Generates Drizzle ORM table schemas at runtime from field definitions.
 * This is used for UI-created collections that don't have pre-compiled TypeScript schemas.
 *
 * Phase 5 (2026-05-01): per-field type mapping is delegated to
 * `field-column-descriptor.ts` so that this generator and the diff
 * engine's `build-from-fields.ts` stay in lockstep. Adding a new field
 * type means updating the descriptor module; this file just translates
 * the descriptor's `kind` to the right Drizzle column builder.
 *
 * @module services/schema/runtime-schema-generator
 */

import { sql } from "drizzle-orm";
import {
  mysqlTable,
  text as mysqlText,
  boolean as mysqlBoolean,
  timestamp as mysqlTimestamp,
  json as mysqlJson,
  varchar as mysqlVarchar,
  double as mysqlDouble,
  decimal as mysqlDecimal,
  int as mysqlInt,
  bigint as mysqlBigint,
  smallint as mysqlSmallint,
  char as mysqlChar,
  float as mysqlFloat,
  longblob as mysqlLongblob,
} from "drizzle-orm/mysql-core";
import {
  pgTable,
  text as pgText,
  boolean as pgBoolean,
  timestamp as pgTimestamp,
  jsonb as pgJsonb,
  doublePrecision as pgDoublePrecision,
  numeric as pgNumeric,
  varchar as pgVarchar,
  integer as pgInteger,
  bigint as pgBigint,
  smallint as pgSmallint,
  char as pgChar,
  uuid as pgUuid,
  real as pgReal,
  serial as pgSerial,
  bytea as pgBytea,
} from "drizzle-orm/pg-core";
import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
  real as sqliteReal,
  numeric as sqliteNumeric,
  blob as sqliteBlob,
} from "drizzle-orm/sqlite-core";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { resolveLocalizedFieldNames } from "../../i18n/classify-fields";
import type { LocalizedColumnSpec } from "../../i18n/migration/types";
import { getActiveExtensionSchema } from "../extension/active-schema";
import { toColumnDescriptor } from "../extension/column-descriptor";
import type { ExtensionColumn } from "../extension/types";

import {
  type ColumnDescriptor,
  type ColumnKind,
  type ColumnOrigin,
  type SupportedDialect as DescriptorDialect,
  DEFAULT_DECIMAL_PRECISION,
  DEFAULT_DECIMAL_SCALE,
  ENUM_STORAGE_LENGTH,
  getColumnDescriptor,
  getSystemColumnDescriptors,
  toSnakeCase,
} from "./field-column-descriptor";

export type SupportedDialect = DescriptorDialect;

// Return type for generateRuntimeSchema - provides the Drizzle table object
// and a schemaRecord keyed by table name for pushSchema() consumption.
export interface RuntimeSchemaResult {
  table: unknown; // PgTable | MySqlTable | SqliteTable
  schemaRecord: Record<string, unknown>; // { [tableName]: table } for pushSchema()
}

/**
 * Toggles that affect which system columns are injected into the runtime
 * Drizzle table — must stay in lockstep with `buildDesiredTableFromFields`'s
 * options so the runtime schema matches the diff descriptor's view.
 */
export interface RuntimeSchemaOptions {
  /**
   * Which builder made this table, for the callers whose output becomes DDL.
   *
   * 🔴 Optional here, and required by `getColumnDescriptor`, because this function has two
   * consumers that observe its columns very differently:
   *
   * - `buildDrizzleSchema` in the push pipeline hands the result to drizzle-kit, which renders it
   *   as `CREATE` / `ALTER`. There the declared width IS the column, so that caller states it.
   * - every other caller registers the result with `SchemaRegistry.registerDynamicSchema`, whose
   *   own comment says it exists to "look up a table object by SQL table name (for queries)". A
   *   query binds a string either way — Drizzle does not enforce a varchar length on read or write,
   *   the database does — so the width is not observed on that path.
   *
   * The default is therefore the reading that changes nothing for a query, and the one path where
   * it does change something passes it. Requiring it everywhere would have put a judgement call at
   * roughly fifty sites that cannot observe the answer, which is how a value nobody can verify ends
   * up pasted in until it compiles.
   */
  builtBy?: ColumnOrigin;
  /** When true, inject a `status` column ('draft' | 'published', default 'draft'). */
  status?: boolean;
  /**
   * When true, this collection is localized: translatable fields live in the companion
   * `_locales` table and are omitted from the main runtime table (kept in lockstep with
   * `buildDesiredTableFromFields`'s `localized` option).
   */
  localized?: boolean;
  /**
   * True for a Single's table — suppresses the collection-only `created_by`
   * owner column. Set internally by generateRuntimeSchema from the table name.
   */
  isSingle?: boolean;
  /**
   * Columns a schema hook contributed to THIS table.
   *
   * Defaulted from the active extension schema rather than required, because
   * this generator is called from roughly twenty-five places and a
   * contributed column missing from any one of them is worse than missing
   * everywhere: the table would then be built without a column the desired
   * spec has, and the next push would propose it as an add on a column that is
   * already there.
   *
   * An explicit value still wins, so a test can build a table without
   * reaching process state.
   */
  extensionColumns?: readonly ExtensionColumn[];
}

/**
 * Generate a Drizzle table schema at runtime from field definitions.
 *
 * @param tableName - The database table name (should include dc_ prefix)
 * @param fields - Array of field definitions from the collection
 * @param dialect - Database dialect (postgresql, mysql, sqlite)
 * @param options - Optional system-column toggles (status etc.)
 * @returns RuntimeSchemaResult with table object and schemaRecord for pushSchema()
 */
export function generateRuntimeSchema(
  tableName: string,
  fields: FieldDefinition[],
  dialect: SupportedDialect,
  options: RuntimeSchemaOptions = {}
): RuntimeSchemaResult {
  // Single tables use the `single_` prefix (collections are `dc_`); a Single
  // gets no owner column. Derive it here so every dialect path sees it.
  const resolvedOptions: RuntimeSchemaOptions = {
    ...options,
    isSingle: options.isSingle ?? tableName.startsWith("single_"),
    extensionColumns:
      options.extensionColumns ?? contributedColumnsFor(tableName, dialect),
  };
  let table: unknown;
  switch (dialect) {
    case "postgresql":
      table = generatePostgresSchema(tableName, fields, resolvedOptions);
      break;
    case "mysql":
      table = generateMySQLSchema(tableName, fields, resolvedOptions);
      break;
    case "sqlite":
      table = generateSQLiteSchema(tableName, fields, resolvedOptions);
      break;
    default:
      throw new Error(`Unsupported dialect: ${String(dialect)}`);
  }
  return {
    table,
    schemaRecord: { [tableName]: table },
  };
}

/** Options for the companion `_locales` runtime table. */
export interface RuntimeCompanionOptions {
  /** When true, inject a per-locale `_status` column ('draft' | 'published'). */
  status?: boolean;
}

/**
 * Generate the queryable Drizzle table for a localized companion (`dc_<slug>_locales`).
 *
 * Columns: `_parent` (FK-shaped, type matching main.id), `_locale` varchar(20), an optional
 * per-locale `_status`, and one nullable column per localized field. Index-only / no FK in the
 * runtime object (mirrors the component child-table precedent — the composite PK + FK live only
 * in M1's raw migration DDL). The companion is registered for queries by M3b; the schema
 * pipeline never diffs it (migration-owned, Option B).
 */
export function generateCompanionRuntimeSchema(
  companionTableName: string,
  columns: LocalizedColumnSpec[],
  dialect: SupportedDialect,
  options: RuntimeCompanionOptions = {}
): RuntimeSchemaResult {
  const record = buildCompanionColumnRecord(columns, dialect, options);
  let table: unknown;
  switch (dialect) {
    case "postgresql":
      table = pgTable(companionTableName, record);
      break;
    case "mysql":
      table = mysqlTable(companionTableName, record);
      break;
    case "sqlite":
      table = sqliteTable(companionTableName, record);
      break;
    default:
      throw new Error(`Unsupported dialect: ${String(dialect)}`);
  }
  return { table, schemaRecord: { [companionTableName]: table } };
}

function buildCompanionColumnRecord(
  columns: LocalizedColumnSpec[],
  dialect: SupportedDialect,
  options: RuntimeCompanionOptions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
  const out: Record<string, any> = {};

  // _parent — type matches the main table's `id` (pg/sqlite text, mysql varchar(36)).
  out._parent =
    dialect === "postgresql"
      ? pgText("_parent").notNull()
      : dialect === "mysql"
        ? mysqlVarchar("_parent", { length: 36 }).notNull()
        : sqliteText("_parent").notNull();

  // _locale — varchar(20) (text on sqlite).
  out._locale =
    dialect === "postgresql"
      ? pgVarchar("_locale", { length: 20 }).notNull()
      : dialect === "mysql"
        ? mysqlVarchar("_locale", { length: 20 }).notNull()
        : sqliteText("_locale").notNull();

  if (options.status === true) {
    out._status =
      dialect === "postgresql"
        ? pgVarchar("_status", { length: 20 }).notNull().default("draft")
        : dialect === "mysql"
          ? mysqlVarchar("_status", { length: 20 }).notNull().default("draft")
          : sqliteText("_status").notNull().default("draft");
  }

  // 🔴 `_updated_at` is deliberately NOT declared here, and the reason is an upgrade
  // path rather than a preference.
  //
  // This runtime table is registered for EVERY localized entity, including collections created in
  // the Schema Builder and stored in the registry. `reconcileCompanionColumns` — the only thing
  // that adds the column to a companion that predates it — runs solely over entities declared in
  // `nextly.config`, so a registry-owned companion has no path that adds it. Declaring the column
  // here anyway would make `populateCompanionFields`'s bare `select()` name a column those tables
  // do not have, and EVERY localized read on them would fail after an upgrade.
  //
  // The stamps are read separately instead, by a helper that projects them explicitly and treats
  // a missing column as UNKNOWN — see `readCompanionStamps` in `../../i18n/companion-join`. The
  // worklist's SQL filter is unaffected either way: it names the column in raw SQL and is guarded
  // by `hasUpdatedAt`.

  // Localized field columns — always nullable (localized-required is app-layer, M2).
  for (const col of columns) {
    const desc: ColumnDescriptor = {
      name: col.name,
      dialectType: "",
      length: col.length,
      nullable: true,
      kind: col.kind,
    };
    out[col.name] = buildUserDrizzleColumn(desc, dialect);
  }

  return out;
}

/**
 * The columns schema hooks contributed to `tableName`, from the active
 * extension schema.
 *
 * One lookup for every runtime-table builder, so an entity table and a
 * field-group table cannot disagree about whether a contribution exists.
 */
export function contributedColumnsFor(
  tableName: string,
  dialect: SupportedDialect
): readonly ExtensionColumn[] {
  return getActiveExtensionSchema(dialect)?.entityColumns.get(tableName) ?? [];
}

/**
 * Add contributed columns to a runtime table's column record, in place.
 *
 * Keyed by their SQL name exactly as `toDrizzleTable` keys an extension
 * table's own — so one column has one key wherever it is read from, and
 * `ctx.db` sees the same handle on both.
 *
 * They must be in every runtime table and not only in the desired spec: the
 * runtime tables are what drizzle-kit is handed, so a table built without them
 * is created without them and the next push proposes DROPPING a column the
 * desired spec still asks for. Present but unhidden, they reach every entry
 * response — which is why `hidden` exists and why the response boundary strips
 * them.
 *
 * A name the record already holds is left alone: a contribution never
 * displaces a system or field column.
 */
export function addContributedDrizzleColumns(
  // Drizzle's column builders are dialect-specific unions; the record is
  // handed straight to pgTable / mysqlTable / sqliteTable.
  columns: Record<string, unknown>,
  contributed: readonly ExtensionColumn[],
  dialect: SupportedDialect
): void {
  for (const column of contributed) {
    if (column.name in columns) continue;
    columns[column.name] = buildUserDrizzleColumn(
      toColumnDescriptor(column, dialect),
      dialect
    );
  }
}

function generatePostgresSchema(
  tableName: string,
  fields: FieldDefinition[],
  options: RuntimeSchemaOptions
): unknown {
  const columns = buildDrizzleColumnRecord(fields, "postgresql", options);
  return pgTable(tableName, columns);
}

function generateMySQLSchema(
  tableName: string,
  fields: FieldDefinition[],
  options: RuntimeSchemaOptions
): unknown {
  const columns = buildDrizzleColumnRecord(fields, "mysql", options);
  return mysqlTable(tableName, columns);
}

function generateSQLiteSchema(
  tableName: string,
  fields: FieldDefinition[],
  options: RuntimeSchemaOptions
): unknown {
  const columns = buildDrizzleColumnRecord(fields, "sqlite", options);
  return sqliteTable(tableName, columns);
}

/**
 * Builds the dialect-keyed column record consumed by Drizzle's
 * pgTable / mysqlTable / sqliteTable. Both system columns and
 * user-field columns flow through `field-column-descriptor.ts`
 * so this generator and `build-from-fields.ts` stay in lockstep.
 */
function buildDrizzleColumnRecord(
  fields: FieldDefinition[],
  dialect: SupportedDialect,
  options: RuntimeSchemaOptions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle requires dialect-specific column builder unions
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
  const out: Record<string, any> = {};

  // A column-less field (e.g. a component, stored in its own table) must not
  // suppress the system title/slug column, or the table would have neither.
  const producesColumn = (f: FieldDefinition): boolean =>
    getColumnDescriptor(f, dialect, options.builtBy ?? "codeFirst") !== null;
  // Matched on the COLUMN the field becomes, not its declared name: an author writing `Title`
  // means the same column, and the three places that make this decision have to agree or one
  // injects a system column the others do not have.
  const declaresColumn = (column: string): boolean =>
    fields.some(f => toSnakeCase(f.name) === column && producesColumn(f));
  const hasTitleField = declaresColumn("title");
  const hasSlugField = declaresColumn("slug");

  // Localized fields live in the companion `_locales` table; omit them from the main table.
  const localizedNames = options.localized
    ? new Set(resolveLocalizedFieldNames(fields, true))
    : new Set<string>();

  // System columns first (id, created_at, updated_at; conditionally title,
  // slug, and status). Source-of-truth descriptor list lives in
  // field-column-descriptor.ts and stays in lockstep with the diff input.
  for (const sys of getSystemColumnDescriptors(dialect, {
    hasTitleField,
    hasSlugField,
    hasStatus: options.status === true,
    // Single tables get no owner column (a Single is one global row). Set by
    // generateRuntimeSchema from the `single_` table prefix so the runtime
    // schema stays in lockstep with the physical table (never selects
    // created_by for a Single).
    isSingle: options.isSingle === true,
  })) {
    out[sys.name] = buildSystemDrizzleColumn(sys, dialect);
  }

  // User-defined fields. Layout-only field types and unmapped types
  // come back as `null` from getColumnDescriptor and are skipped.
  for (const field of fields) {
    if (localizedNames.has(field.name)) continue; // companion-owned
    const desc = getColumnDescriptor(
      field,
      dialect,
      options.builtBy ?? "codeFirst"
    );
    if (!desc) continue;
    out[field.name] = buildUserDrizzleColumn(desc, dialect);
  }

  addContributedDrizzleColumns(out, options.extensionColumns ?? [], dialect);

  return out;
}

/**
 * Applies the modifiers every column family shares.
 *
 * Structurally typed rather than tied to one Drizzle builder, because the three families return
 * three unrelated builder types that all carry these two methods. A primary key is already NOT NULL
 * on every dialect, so it is not also marked.
 */
function finishColumn<T extends { notNull(): unknown; primaryKey(): unknown }>(
  column: T,
  spec: { nullable: boolean; primaryKey: boolean }
): unknown {
  if (spec.primaryKey) return column.primaryKey();
  return spec.nullable ? column : column.notNull();
}

/**
 * Translates a system-column descriptor into the Drizzle column builder for the given dialect.
 *
 * Dispatches on the declared column FAMILY, never on the column name. Name dispatch carried a
 * fall-through that made anything unrecognised a non-null text column, so a newly declared
 * timestamp was created in the database as a timestamp and read back through a text column —
 * precisely the drift between the physical table and the runtime schema that the declarations
 * exist to prevent.
 *
 * The timestamps stay nullable, but a row reaching the database without them does not: the
 * default supplies a value for any insert that omits the column, which is what an insert
 * bypassing the write path does. Nullable and defaulted are independent choices, and only
 * the default can be added to a table a user already has without rewriting its rows. A column
 * declared with no default keeps none — a first-publication marker must read NULL until it is
 * earned, and a default would date a publication that never happened.
 */
function buildSystemDrizzleColumn(
  sys: ReturnType<typeof getSystemColumnDescriptors>[number],
  dialect: SupportedDialect
): unknown {
  const literal =
    sys.defaultValue?.kind === "literal" ? sys.defaultValue.value : undefined;
  const clockDefault = sys.defaultValue?.kind === "now";

  if (dialect === "postgresql") {
    if (sys.kind === "timestamp") {
      const col = pgTimestamp(sys.name);
      return finishColumn(clockDefault ? col.defaultNow() : col, sys);
    }
    if (sys.kind === "varchar") {
      const col = pgVarchar(sys.name, { length: sys.length ?? 255 });
      return finishColumn(
        literal === undefined ? col : col.default(literal),
        sys
      );
    }
    const col = pgText(sys.name);
    return finishColumn(
      literal === undefined ? col : col.default(literal),
      sys
    );
  }

  if (dialect === "mysql") {
    if (sys.kind === "timestamp") {
      const col = mysqlTimestamp(sys.name);
      return finishColumn(clockDefault ? col.defaultNow() : col, sys);
    }
    if (sys.kind === "varchar") {
      const col = mysqlVarchar(sys.name, { length: sys.length ?? 255 });
      return finishColumn(
        literal === undefined ? col : col.default(literal),
        sys
      );
    }
    const col = mysqlText(sys.name);
    return finishColumn(
      literal === undefined ? col : col.default(literal),
      sys
    );
  }

  // SQLite stores a timestamp as an epoch integer and has no distinct varchar.
  if (sys.kind === "timestamp") {
    const col = sqliteInteger(sys.name, { mode: "timestamp" });
    return finishColumn(
      clockDefault ? col.default(sql`(strftime('%s', 'now'))`) : col,
      sys
    );
  }
  const col = sqliteText(sys.name);
  return finishColumn(literal === undefined ? col : col.default(literal), sys);
}

/**
 * Apply nullability once, rather than in every arm.
 *
 * Each builder below had `nullable ? col : col.notNull()` repeated per kind,
 * which doubled the branch count of a function that is otherwise a lookup.
 * The arms now return the column and this decides.
 */
function withNullability(column: unknown, nullable: boolean): unknown {
  if (nullable) return column;
  const chainable = column as { notNull?: () => unknown };
  return typeof chainable.notNull === "function" ? chainable.notNull() : column;
}

/**
 * The `created_at` / `updated_at` pair every SQLite runtime table built from
 * fields declares: integer timestamps, not null, stamped by the application,
 * since SQLite has no timestamp default of its own that Drizzle reads back as
 * a Date.
 */
export function sqliteTimestampColumns(): {
  created_at: unknown;
  updated_at: unknown;
} {
  return {
    created_at: sqliteInteger("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updated_at: sqliteInteger("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  };
}

/**
 * Translates a user-field descriptor into the appropriate Drizzle
 * column builder. The descriptor's `kind` is the dispatch key —
 * the per-dialect Drizzle imports stay isolated to this function.
 */
export function buildUserDrizzleColumn(
  desc: ColumnDescriptor,
  dialect: SupportedDialect
): unknown {
  if (dialect === "postgresql") {
    return buildPgColumnFromKind(desc.kind, desc.name, desc.nullable, desc);
  }
  if (dialect === "mysql") {
    return buildMysqlColumnFromKind(
      desc.kind,
      desc.name,
      desc.nullable,
      desc.length,
      desc
    );
  }
  return buildSqliteColumnFromKind(desc.kind, desc.name, desc.nullable);
}

// Decimal precision/scale carried on the descriptor; falls back to the
// DECIMAL(10,2) default the descriptor also uses so the two never diverge.
function decimalConfig(desc: ColumnDescriptor): {
  precision: number;
  scale: number;
  mode: "number";
} {
  // `mode: "number"` reads the column back as a JS number, matching the number
  // field's value contract (the same contract the `double` kind honors).
  return {
    precision: desc.precision ?? DEFAULT_DECIMAL_PRECISION,
    scale: desc.scale ?? DEFAULT_DECIMAL_SCALE,
    mode: "number",
  };
}

export function buildPgColumnFromKind(
  kind: ColumnKind,
  name: string,
  nullable: boolean,
  desc: ColumnDescriptor
): unknown {
  switch (kind) {
    case "text":
    case "longText":
    case "varchar":
      return withNullability(pgText(name), nullable);
    case "shortText": {
      // The one string kind PostgreSQL bounds. The others render `text` there, so binding this as
      // text too would leave the ORM describing a column the DDL declared with a width.
      const col = pgVarchar(name, { length: desc.length ?? 255 });
      return withNullability(col, nullable);
    }
    case "boolean":
      return withNullability(pgBoolean(name), nullable);
    case "integer":
      return withNullability(pgInteger(name), nullable);
    case "double":
      return withNullability(pgDoublePrecision(name), nullable);
    case "decimal": {
      const col = pgNumeric(name, decimalConfig(desc));
      return withNullability(col, nullable);
    }
    case "timestamp":
      return withNullability(pgTimestamp(name), nullable);
    case "json":
      return withNullability(pgJsonb(name), nullable);
    case "fkSingle":
      return pgText(name);
    // Extension-only kinds. Omitting them does NOT fail to compile — this
    // function returns `unknown`, so a missing case falls through to
    // `undefined` and the table receives a non-column. Every kind is listed
    // for that reason.
    case "bigint": {
      const col = pgBigint(name, { mode: "number" });
      return withNullability(col, nullable);
    }
    case "smallint":
      return withNullability(pgSmallint(name), nullable);
    case "serial":
      // The database assigns it, so it is never nullable and never written:
      // `withNullability` is deliberately not applied, because a generated
      // key declared nullable would let an insert send an explicit NULL.
      return pgSerial(name);
    case "char": {
      const col = pgChar(name, { length: desc.length ?? 1 });
      return withNullability(col, nullable);
    }
    case "uuid":
      return withNullability(pgUuid(name), nullable);
    case "real":
      return withNullability(pgReal(name), nullable);
    case "bytes":
      // `bytea`, the type the descriptor renders and the migration creates,
      // so a table pushed from this builder and one built by the migration
      // are the same physical column. Reads and writes are Buffers.
      return withNullability(pgBytea(name), nullable);
    case "enum":
      // A native PostgreSQL enum needs its TYPE, which this builder has no
      // handle on. Text keeps reads and writes working; the constraint is
      // carried by the migration.
      return withNullability(pgText(name), nullable);
    case "skip":
      return null;
  }
}

export function buildMysqlColumnFromKind(
  kind: ColumnKind,
  name: string,
  nullable: boolean,
  length: number | undefined,
  desc: ColumnDescriptor
): unknown {
  switch (kind) {
    case "text":
    case "shortText":
    case "varchar": {
      const col = mysqlVarchar(name, { length: length ?? 255 });
      return withNullability(col, nullable);
    }
    case "longText":
      return withNullability(mysqlText(name), nullable);
    case "boolean":
      return withNullability(mysqlBoolean(name), nullable);
    case "integer":
      return withNullability(mysqlInt(name), nullable);
    case "double":
      return withNullability(mysqlDouble(name), nullable);
    case "decimal": {
      const col = mysqlDecimal(name, decimalConfig(desc));
      return withNullability(col, nullable);
    }
    case "timestamp":
      return withNullability(mysqlTimestamp(name), nullable);
    case "json":
      return withNullability(mysqlJson(name), nullable);
    case "fkSingle":
      return mysqlVarchar(name, { length: length ?? 36 });
    // See the PostgreSQL builder: a missing case falls through to `undefined`
    // rather than failing to compile, so every kind is listed.
    case "bigint": {
      const col = mysqlBigint(name, { mode: "number" });
      return withNullability(col, nullable);
    }
    case "smallint":
      return withNullability(mysqlSmallint(name), nullable);
    case "serial":
      // `.autoincrement()` is what makes it AUTO_INCREMENT; MySQL requires
      // such a column to be a key, which the DDL declares.
      return mysqlInt(name).autoincrement().notNull();
    case "char": {
      const col = mysqlChar(name, { length: length ?? 1 });
      return withNullability(col, nullable);
    }
    case "uuid": {
      const col = mysqlChar(name, { length: 36 });
      return withNullability(col, nullable);
    }
    case "real":
      return withNullability(mysqlFloat(name), nullable);
    case "bytes":
      // `longblob`, as the descriptor renders it: variable length and
      // unbounded, where a fixed `binary(n)` would pad every value to n bytes
      // and refuse a longer one. Buffer mode, so values round-trip as bytes.
      return withNullability(mysqlLongblob(name), nullable);
    case "enum": {
      // The width the descriptor renders, from the one constant both read.
      const col = mysqlVarchar(name, { length: ENUM_STORAGE_LENGTH });
      return withNullability(col, nullable);
    }
    case "skip":
      return null;
  }
}

export function buildSqliteColumnFromKind(
  kind: ColumnKind,
  name: string,
  nullable: boolean
): unknown {
  switch (kind) {
    case "text":
    case "longText":
    case "shortText":
    case "varchar":
      return withNullability(sqliteText(name), nullable);
    case "boolean":
      return withNullability(
        sqliteInteger(name, { mode: "boolean" }),
        nullable
      );
    case "integer":
      return withNullability(sqliteInteger(name), nullable);
    case "double":
      return withNullability(sqliteReal(name), nullable);
    case "decimal": {
      // SQLite has no fixed-precision decimal; NUMERIC affinity is the closest,
      // read back as a JS number to match the field's value contract.
      const col = sqliteNumeric(name, { mode: "number" });
      return withNullability(col, nullable);
    }
    case "timestamp":
      return withNullability(
        sqliteInteger(name, { mode: "timestamp" }),
        nullable
      );
    case "json":
      // SQLite stores JSON as text.
      return withNullability(sqliteText(name), nullable);
    case "fkSingle":
      return sqliteText(name);
    case "skip":
      return null;
    default:
      return buildSqliteExtensionColumn(kind, name, nullable);
  }
}

/**
 * The kinds only an extension table can declare.
 *
 * Split from the field kinds above because they are a different list with a
 * different author: a field kind comes from a collection's config, these come
 * from the schema DSL. Kept apart so neither switch grows past the point
 * where a missing case is easy to see — and a missing case here returns
 * `undefined`, which Drizzle accepts as a non-column.
 */
function buildSqliteExtensionColumn(
  kind: Exclude<ColumnKind, "skip">,
  name: string,
  nullable: boolean
): unknown {
  switch (kind) {
    // SQLite has one integer type and one text type, so most of these
    // collapse — the declaration stays portable because what it promises is
    // the value's shape, not the storage word.
    case "bigint":
    case "smallint":
      return withNullability(sqliteInteger(name), nullable);
    case "serial":
      // SQLite has no serial type: a plain INTEGER that is the table's
      // primary key IS the rowid alias and auto-assigns, which is the closest
      // faithful rendering and the one `renderDialectType` describes.
      return sqliteInteger(name).notNull();
    case "char":
    case "uuid":
    case "enum":
      return withNullability(sqliteText(name), nullable);
    case "real":
      return withNullability(sqliteReal(name), nullable);
    case "bytes":
      // Buffer mode: without it Drizzle's SQLite blob is its JSON mode, which
      // stores `JSON.stringify(value)` and reads back a parsed object, so the
      // bytes written would not be the bytes read.
      return withNullability(sqliteBlob(name, { mode: "buffer" }), nullable);
    default:
      return undefined;
  }
}

// Phase 5 (2026-05-01): the legacy mapFieldToPostgresColumn /
// mapFieldToMySQLColumn / mapFieldToSQLiteColumn switches were removed.
// Their logic was duplicated against pipeline/diff/build-from-fields.ts
// and inevitably drifted (notably: hasMany / relationTo[] handling for
// relations). All per-field type mapping now flows through
// services/field-column-descriptor.ts, with the dialect-specific
// Drizzle column construction handled by the buildXxxColumnFromKind
// helpers above. Adding a new field type means updating one place.
