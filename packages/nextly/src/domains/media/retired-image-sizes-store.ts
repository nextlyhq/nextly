/**
 * Reading and clearing the retired `sizes` column, finding the retired
 * `image_sizes` table, and dropping both, in a database that may or may not
 * still have them.
 *
 * Neither is in Nextly's Drizzle definitions any more: a new install never
 * gets them, and a database whose size files were removed and whose column and
 * table were then dropped no longer has them. So every read here names them
 * through Drizzle's `sql` template with quoted identifiers, and asks first
 * whether they are there rather than assuming it from the version.
 *
 * Being there by name is not enough. Each is taken for what image sizes left
 * only when the database shows Nextly made it, because both are read and then
 * dropped, and a column's values are taken for files to delete:
 *
 * - the column only with the type Nextly declared it with, and no record in
 *   `nextly_schema_owners` of an app or a plugin having added it. A contributed
 *   column of that name is refused at declaration (`isReservedCoreColumn`), so
 *   the record is a check on that refusal rather than the only one.
 * - the table only with exactly the columns and types Nextly created it with,
 *   no owner record naming it, and the media table still holding that column
 *   beside it. Nothing records which core tables Nextly created, so the shape
 *   and the column are the evidence; a table that shows anything less is kept
 *   and named rather than dropped.
 *
 * @module domains/media/retired-image-sizes-store
 */
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import { isMissingNamedColumnError } from "../../database/missing-column";
import { NextlyError } from "../../errors/nextly-error";
import { SCHEMA_OWNERS_TABLE } from "../../schemas/schema-owners/table-name";
import type { OwnerRecord } from "../schema/ownership/owner-registry";
import { queryLiveColumnTypes } from "../schema/pipeline/live-column-types";

import {
  holdsStoredSizes,
  type MediaSizesRow,
  type RetiredObjects,
  type RetiredSizesStore,
} from "./retired-image-sizes";
import {
  REMOVE_SIZES_COMMAND,
  RETIRED_IMAGE_SIZES_TABLE,
  RETIRED_SIZES_COLUMN,
} from "./retired-image-sizes-constants";

/** Rows read per page, so a large library is never held in one result. */
const PAGE = 500;

/**
 * The `sizes` column's type as Nextly declared it, as the live introspection
 * reads it: PostgreSQL's `udt_name`, MySQL's `COLUMN_TYPE`, SQLite's declared
 * type lower-cased.
 */
const LEGACY_SIZES_TYPE: Record<SupportedDialect, string> = {
  postgresql: "jsonb",
  mysql: "json",
  sqlite: "text",
};

/**
 * Every column of the `image_sizes` table as Nextly created it, with its type,
 * read as `LEGACY_SIZES_TYPE` is. A table of that name with a column more, a
 * column fewer or a type of its own is not shown to be Nextly's.
 */
const LEGACY_TABLE_TYPES: Record<
  SupportedDialect,
  Readonly<Record<string, string>>
> = {
  postgresql: {
    id: "text",
    name: "varchar",
    width: "int4",
    height: "int4",
    fit: "varchar",
    quality: "int4",
    format: "varchar",
    is_default: "bool",
    sort_order: "int4",
    created_at: "timestamp",
    updated_at: "timestamp",
  },
  mysql: {
    id: "varchar(36)",
    name: "varchar(50)",
    width: "int",
    height: "int",
    fit: "varchar(20)",
    quality: "int",
    format: "varchar(10)",
    is_default: "tinyint(1)",
    sort_order: "int",
    created_at: "datetime",
    updated_at: "datetime",
  },
  sqlite: {
    id: "text",
    name: "text",
    width: "integer",
    height: "integer",
    fit: "text",
    quality: "integer",
    format: "text",
    is_default: "integer",
    sort_order: "integer",
    created_at: "integer",
    updated_at: "integer",
  },
};

/** The rows a statement returns, from each driver's result shape. */
async function rowsOf<T>(
  db: unknown,
  dialect: SupportedDialect,
  statement: SQL
): Promise<T[]> {
  if (dialect === "sqlite") {
    return await (db as { all(query: SQL): T[] | Promise<T[]> }).all(statement);
  }
  const raw = await (db as { execute(query: SQL): Promise<unknown> }).execute(
    statement
  );
  // node-postgres answers `{ rows }`; mysql2 a `[rows, fields]` tuple.
  if (Array.isArray(raw)) return (Array.isArray(raw[0]) ? raw[0] : raw) as T[];
  const rows = (raw as { rows?: unknown }).rows;
  if (Array.isArray(rows)) return rows as T[];
  throw NextlyError.internal({
    logContext: { reason: "unrecognised result shape", dialect },
  });
}

/** Runs a statement that returns no rows. */
async function run(
  db: unknown,
  dialect: SupportedDialect,
  statement: SQL
): Promise<void> {
  if (dialect === "sqlite") {
    await (db as { run(query: SQL): unknown }).run(statement);
    return;
  }
  await (db as { execute(query: SQL): Promise<unknown> }).execute(statement);
}

const media = sql.identifier("media");
const sizes = sql.identifier(RETIRED_SIZES_COLUMN);
const id = sql.identifier("id");

/**
 * The owner records naming `table`, or none where the database has no owner
 * registry yet. Asked of the catalogue first: reading a missing table would
 * abort a PostgreSQL transaction the caller is inside.
 */
async function ownerRecordsOf(
  db: unknown,
  dialect: SupportedDialect,
  table: string,
  live: ReadonlyMap<string, unknown>
): Promise<OwnerRecord[]> {
  if (!live.has(SCHEMA_OWNERS_TABLE)) return [];
  const { SchemaOwnersRepository } = await import(
    "../schema/ownership/schema-owners-repository"
  );
  return new SchemaOwnersRepository(db, dialect).read([table]);
}

/** The live types of the media table, the `image_sizes` table and the owner registry. */
function liveTypes(
  db: unknown,
  dialect: SupportedDialect
): Promise<Map<string, Map<string, string>>> {
  return queryLiveColumnTypes(db, dialect, [
    "media",
    RETIRED_IMAGE_SIZES_TABLE,
    SCHEMA_OWNERS_TABLE,
  ]);
}

/**
 * Whether the media table's `sizes` column is the one image sizes were stored
 * in: there, of the type Nextly declared it with, and claimed by no app or
 * plugin. Read from the catalogue, which never fails for a missing column, so
 * asking cannot abort a PostgreSQL transaction the caller is inside.
 */
async function legacySizesColumn(
  db: unknown,
  dialect: SupportedDialect,
  live: ReadonlyMap<string, ReadonlyMap<string, string>>
): Promise<boolean> {
  const type = live.get("media")?.get(RETIRED_SIZES_COLUMN);
  if (type !== LEGACY_SIZES_TYPE[dialect]) return false;
  const claims = await ownerRecordsOf(db, dialect, "media", live);
  return !claims.some(
    record =>
      record.elementKind === "column" &&
      record.elementName === RETIRED_SIZES_COLUMN
  );
}

/**
 * Whether the media table still has the `sizes` column image sizes were
 * stored in (`legacySizesColumn`). Every reader of the column asks this first,
 * so none reads a column of that name an app or a plugin owns.
 */
export async function hasRetiredSizesColumn(
  db: unknown,
  dialect: SupportedDialect
): Promise<boolean> {
  return legacySizesColumn(db, dialect, await liveTypes(db, dialect));
}

/**
 * Why a table named `image_sizes` is not shown to be the one Nextly created,
 * or null when it is. `legacyColumn` is whether the media table still has the
 * `sizes` column created beside it.
 */
async function unprovenTableReason(
  db: unknown,
  dialect: SupportedDialect,
  live: ReadonlyMap<string, ReadonlyMap<string, string>>,
  legacyColumn: boolean
): Promise<string | null> {
  const columns = live.get(RETIRED_IMAGE_SIZES_TABLE);
  if (!columns) return null;
  const expected = Object.entries(LEGACY_TABLE_TYPES[dialect]);
  const sameShape =
    columns.size === expected.length &&
    expected.every(([name, type]) => columns.get(name) === type);
  if (!sameShape) {
    return "its columns are not exactly the ones Nextly created it with";
  }
  const claims = await ownerRecordsOf(
    db,
    dialect,
    RETIRED_IMAGE_SIZES_TABLE,
    live
  );
  if (claims.length > 0) {
    const [owner] = claims;
    return `${SCHEMA_OWNERS_TABLE} records it as ${owner.ownerKind} "${owner.ownerId}"'s`;
  }
  if (!legacyColumn) {
    return "the media table no longer has the `sizes` column Nextly created beside it, so nothing shows Nextly made this table";
  }
  return null;
}

/** The row count of the `image_sizes` table. */
async function tableRowCount(
  db: unknown,
  dialect: SupportedDialect
): Promise<number> {
  const [row] = await rowsOf<{ count: number | string }>(
    db,
    dialect,
    sql`SELECT COUNT(*) AS ${sql.identifier("count")} FROM ${sql.identifier(RETIRED_IMAGE_SIZES_TABLE)}`
  );
  return Number(row?.count ?? 0);
}

/**
 * What is left of the retired column and table, read from the database: the
 * column only where it is the one image sizes were stored in, the table's row
 * count only where it is shown to be the one Nextly created, and why a table
 * of that name is not, where one is there but not shown.
 */
export async function readRetiredObjects(
  db: unknown,
  dialect: SupportedDialect
): Promise<RetiredObjects> {
  const live = await liveTypes(db, dialect);
  const column = await legacySizesColumn(db, dialect, live);
  const keptTable = await unprovenTableReason(db, dialect, live, column);
  const legacyTable = live.has(RETIRED_IMAGE_SIZES_TABLE) && keptTable === null;
  return {
    column,
    tableRows: legacyTable ? await tableRowCount(db, dialect) : null,
    keptTable,
  };
}

/** A page of media rows after `after`, by id, with the columns named. */
function pageAfter(after: string | undefined, columns: SQL, where?: SQL): SQL {
  const conditions = [
    ...(after === undefined ? [] : [sql`${id} > ${after}`]),
    ...(where === undefined ? [] : [where]),
  ];
  const filter =
    conditions.length === 0
      ? sql``
      : sql` WHERE ${sql.join(conditions, sql` AND `)}`;
  return sql`SELECT ${columns} FROM ${media}${filter} ORDER BY ${id} LIMIT ${PAGE}`;
}

interface RawSizesRow {
  id: string;
  filename: string;
  url: string;
  thumbnail_url: string | null;
  sizes: unknown;
}

/**
 * The store `nextly media remove-sizes` reads and clears through. Only for a
 * database that has the column: the caller asks `hasRetiredSizesColumn` first.
 *
 * Rows are paged by id, each page starting after the last id read, so an item
 * deleted while this reads never makes a later one be skipped.
 */
export function sqlRetiredSizesStore(
  db: unknown,
  dialect: SupportedDialect
): RetiredSizesStore {
  return {
    async *rows() {
      const columns = sql.join(
        ["id", "filename", "url", "thumbnail_url", RETIRED_SIZES_COLUMN].map(
          name => sql.identifier(name)
        ),
        sql`, `
      );
      let after: string | undefined;
      for (;;) {
        const page = await rowsOf<RawSizesRow>(
          db,
          dialect,
          pageAfter(after, columns)
        );
        yield page.map(
          (row): MediaSizesRow => ({
            id: row.id,
            filename: row.filename,
            url: row.url,
            thumbnailUrl: row.thumbnail_url,
            sizes: row.sizes,
          })
        );
        if (page.length < PAGE) return;
        after = page[page.length - 1].id;
      }
    },
    async clearSizes(itemId) {
      await run(
        db,
        dialect,
        sql`UPDATE ${media} SET ${sizes} = NULL WHERE ${id} = ${itemId}`
      );
    },
  };
}

/**
 * How many media items still name size files: the number the drop refuses
 * for. Read in pages of the rows whose `sizes` is not NULL, and judged as the
 * removal judges them, so an empty object counts as none and a value that
 * cannot be read counts as some. Only for a database that has the column.
 */
async function countItemsWithSizes(
  db: unknown,
  dialect: SupportedDialect
): Promise<number> {
  let count = 0;
  let after: string | undefined;
  for (;;) {
    const page = await rowsOf<{ id: string; sizes: unknown }>(
      db,
      dialect,
      pageAfter(after, sql`${id}, ${sizes}`, sql`${sizes} IS NOT NULL`)
    );
    count += page.filter(row => holdsStoredSizes(row.sizes)).length;
    if (page.length < PAGE) return count;
    after = page[page.length - 1].id;
  }
}

/** Reads the stored `sizes` of the given items, by id. */
export type RetiredSizesReader = (
  ids: readonly string[]
) => Promise<Map<string, unknown>>;

/**
 * A reader of items' stored `sizes` for one scan of the media table, page by
 * page or batch by batch. Whether the column is the one image sizes were
 * stored in (`hasRetiredSizesColumn`) is two metadata reads, asked once, on
 * the first read, and reused for every later one: a scan of a large library
 * would otherwise repeat them per page. A failed ask is not kept, so the next
 * read asks again rather than repeating the failure.
 *
 * Nothing makes the column while a scan runs, and a drop meanwhile makes the
 * next read fail rather than answer as if no item had sizes.
 */
export function retiredSizesReader(
  db: unknown,
  dialect: SupportedDialect
): RetiredSizesReader {
  let column: Promise<boolean> | undefined;
  return async ids => {
    if (ids.length === 0) return new Map<string, unknown>();
    column ??= hasRetiredSizesColumn(db, dialect).catch((error: unknown) => {
      column = undefined;
      throw error;
    });
    if (!(await column)) return new Map<string, unknown>();
    const found = await sizesByIdOrGone(ids, statement =>
      rowsOf<SizesRow>(db, dialect, statement)
    );
    if (found === null) column = Promise.resolve(false);
    return found ?? new Map<string, unknown>();
  };
}

/** One item's stored `sizes`, as the read of them returns it. */
interface SizesRow {
  id: string;
  sizes: unknown;
}

/**
 * The stored `sizes` of `ids`, by id, read through `read`; null when the
 * column is gone. One statement and one reading of its failure for every
 * reader, on the pool or on a transaction.
 */
async function sizesByIdOrGone(
  ids: readonly string[],
  read: (statement: SQL) => Promise<SizesRow[]>
): Promise<Map<string, unknown> | null> {
  let rows: SizesRow[];
  try {
    rows = await read(
      sql`SELECT ${id}, ${sizes} FROM ${media} WHERE ${id} IN (${sql.join(
        ids.map(value => sql`${value}`),
        sql`, `
      )}) AND ${sizes} IS NOT NULL`
    );
  } catch (error) {
    // The column dropped since its provenance was asked, as
    // `nextly media remove-sizes --apply --drop` can during a delete. It is
    // dropped only once no item names a size file, so there are none to
    // read, and failing would abort the delete. Told by the driver's code
    // for a missing column and by its name; any other failure is the
    // caller's.
    if (!isMissingNamedColumnError(error, RETIRED_SIZES_COLUMN)) throw error;
    return null;
  }
  const found = new Map<string, unknown>();
  for (const row of rows) found.set(row.id, row.sizes);
  return found;
}

/** What a read of the retired sizes on a transaction uses of it. */
export type SizesTransaction = Pick<
  TransactionContext,
  "queryStatement" | "savepoint" | "rollbackToSavepoint" | "releaseSavepoint"
>;

/** The savepoint a read on a transaction runs under, where it has them. */
const SIZES_SAVEPOINT = "nextly_retired_sizes";

/**
 * The stored `sizes` of `ids` read on `tx`, for a delete that removes the
 * size files of exactly the rows it holds locked there. The caller asks the
 * column's provenance first (`hasRetiredSizesColumn`), before its
 * transaction, and reads only when that says the column is there.
 *
 * A drop of the column after that ask fails this read with a missing column,
 * read as no sizes, as the pooled reader reads it. On PostgreSQL that failure
 * aborts the whole transaction, so the read runs under a savepoint wherever
 * the transaction has them and only the savepoint is rolled back. MySQL has
 * none here, and a failed statement there does not end its transaction.
 */
export async function retiredSizesOnTransaction(
  tx: SizesTransaction,
  ids: readonly string[]
): Promise<Map<string, unknown>> {
  if (ids.length === 0) return new Map<string, unknown>();
  await tx.savepoint?.(SIZES_SAVEPOINT);
  const found = await sizesByIdOrGone(ids, statement =>
    tx.queryStatement<SizesRow>(statement)
  );
  if (found === null) {
    await tx.rollbackToSavepoint?.(SIZES_SAVEPOINT);
    return new Map<string, unknown>();
  }
  await tx.releaseSavepoint?.(SIZES_SAVEPOINT);
  return found;
}

/**
 * The stored `sizes` of the given items, while the column exists: what a
 * delete of those items reads to remove their size files too. Empty when the
 * column is gone. For one read; a scan in pages reads through one
 * `retiredSizesReader`.
 */
export function storedSizesOf(
  db: unknown,
  dialect: SupportedDialect,
  ids: readonly string[]
): Promise<Map<string, unknown>> {
  return retiredSizesReader(db, dialect)(ids);
}

/** Runs one generated DDL statement. */
type ExecuteSql = (statement: string) => Promise<unknown>;

/** A foreign key another table holds to `image_sizes`: its table, and its name. */
interface InboundForeignKey {
  table: string;
  name: string;
}

/**
 * The foreign keys other tables hold to `image_sizes`, from each dialect's
 * catalogue: PostgreSQL's `pg_constraint`, MySQL's key usage, and SQLite's
 * foreign key list of every table, which names no constraint, so a key is
 * named there by its column. An app could have pointed one at the table
 * while Nextly published it.
 */
async function foreignKeysToImageSizes(
  db: unknown,
  dialect: SupportedDialect
): Promise<InboundForeignKey[]> {
  const table = sql.identifier("table");
  const name = sql.identifier("name");
  const statement =
    dialect === "postgresql"
      ? sql`SELECT conrelid::regclass::text AS ${table}, conname AS ${name} FROM pg_constraint WHERE contype = 'f' AND confrelid = to_regclass(${RETIRED_IMAGE_SIZES_TABLE})`
      : dialect === "mysql"
        ? sql`SELECT DISTINCT TABLE_NAME AS ${table}, CONSTRAINT_NAME AS ${name} FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ${RETIRED_IMAGE_SIZES_TABLE}`
        : sql`SELECT m.name AS ${table}, 'on column ' || f."from" AS ${name} FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f WHERE m.type = 'table' AND f."table" = ${RETIRED_IMAGE_SIZES_TABLE}`;
  return rowsOf<InboundForeignKey>(db, dialect, statement);
}

/** A view or a trigger, as each dialect's catalogue keeps its SQL. */
interface SchemaObjectSql {
  kind: string;
  name: string;
  /** A trigger's table; null for a view. */
  on: string | null;
  body: string | null;
}

/** Whether `text` names `identifier` as a whole name, quoted or not. */
function namesIdentifier(text: string, identifier: string): boolean {
  return new RegExp(
    `(^|[^A-Za-z0-9_$])${identifier}([^A-Za-z0-9_$]|$)`,
    "i"
  ).test(text);
}

/**
 * The views and triggers whose SQL uses what the drop removes: the
 * `image_sizes` table, or the media table's `sizes` column. Each dialect
 * keeps that SQL and lets the drop go on under it, or refuses with an error
 * only partway: SQLite and MySQL keep a view over the dropped table, which
 * then fails on every read; a trigger's body, or on PostgreSQL its
 * function's, is kept everywhere and fails when it fires; and the column's
 * drop under a view is refused by PostgreSQL and SQLite, SQLite's after the
 * table has gone. Judged from the SQL text, as no dialect records what a
 * trigger body uses: a whole-name match can only refuse more, naming what it
 * refused for. A trigger on `image_sizes` itself goes with the table.
 */
async function schemaObjectsUsingRetired(
  db: unknown,
  dialect: SupportedDialect,
  objects: RetiredObjects
): Promise<string[]> {
  if (!objects.column && objects.tableRows === null) return [];
  const found = await rowsOf<SchemaObjectSql>(
    db,
    dialect,
    viewsAndTriggersStatement(dialect)
  );
  return found.flatMap(object => {
    const use = retiredUseOf(object, objects);
    return use === null ? [] : [use];
  });
}

/**
 * Each dialect's views and triggers, with their SQL: a view's definition,
 * a trigger's body, or on PostgreSQL its function's. Every name that
 * matters contains `sizes`, so only those are read.
 */
function viewsAndTriggersStatement(dialect: SupportedDialect): SQL {
  const kind = sql.identifier("kind");
  const name = sql.identifier("name");
  const on = sql.identifier("on");
  const body = sql.identifier("body");
  if (dialect === "postgresql") {
    return sql`SELECT 'view' AS ${kind}, viewname AS ${name}, NULL AS ${on}, definition AS ${body} FROM pg_views WHERE schemaname = current_schema() AND definition ILIKE '%sizes%' UNION ALL SELECT 'trigger', t.tgname, c.relname, p.prosrc FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid WHERE NOT t.tgisinternal AND n.nspname = current_schema() AND p.prosrc ILIKE '%sizes%'`;
  }
  if (dialect === "mysql") {
    return sql`SELECT 'view' AS ${kind}, TABLE_NAME AS ${name}, NULL AS ${on}, VIEW_DEFINITION AS ${body} FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE() AND VIEW_DEFINITION LIKE '%sizes%' UNION ALL SELECT 'trigger', TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND ACTION_STATEMENT LIKE '%sizes%'`;
  }
  return sql`SELECT type AS ${kind}, name AS ${name}, CASE WHEN type = 'trigger' THEN tbl_name END AS ${on}, sql AS ${body} FROM sqlite_master WHERE type IN ('view', 'trigger') AND sql LIKE '%sizes%'`;
}

/**
 * How a view or trigger uses what the drop removes, for the refusal, or
 * null when it uses neither: the `image_sizes` table, unless it is a
 * trigger on that table, which goes with it; or the media table's `sizes`
 * column, named beside the media table or in a trigger on it.
 */
function retiredUseOf(
  object: SchemaObjectSql,
  objects: RetiredObjects
): string | null {
  const uses = [
    ...(usesRetiredTable(object, objects)
      ? [`the \`${RETIRED_IMAGE_SIZES_TABLE}\` table`]
      : []),
    ...(usesRetiredColumn(object, objects)
      ? [`the \`media.${RETIRED_SIZES_COLUMN}\` column`]
      : []),
  ];
  if (uses.length === 0) return null;
  const where = object.on === null ? "" : ` on \`${object.on}\``;
  return `${object.kind} \`${object.name}\`${where} uses ${uses.join(" and ")}`;
}

/**
 * Whether a view or trigger uses the `image_sizes` table the drop removes:
 * named in its SQL, unless it is a trigger on that table, which goes with it.
 */
function usesRetiredTable(
  object: SchemaObjectSql,
  objects: RetiredObjects
): boolean {
  return (
    objects.tableRows !== null &&
    object.on !== RETIRED_IMAGE_SIZES_TABLE &&
    namesIdentifier(object.body ?? "", RETIRED_IMAGE_SIZES_TABLE)
  );
}

/**
 * Whether a view or trigger uses the media table's `sizes` column the drop
 * removes: named in SQL that names the media table too, or in a trigger on it.
 */
function usesRetiredColumn(
  object: SchemaObjectSql,
  objects: RetiredObjects
): boolean {
  const text = object.body ?? "";
  const onMedia = object.on === "media" || namesIdentifier(text, "media");
  return (
    objects.column && onMedia && namesIdentifier(text, RETIRED_SIZES_COLUMN)
  );
}

/**
 * Why nothing may be dropped now, or null when the drop may go on: a media
 * item still naming a size file, which dropping the column would leave in
 * storage with nothing pointing at it, a foreign key another table holds
 * to `image_sizes`, or a view or trigger using either
 * (`schemaObjectsUsingRetired`). Those are an app's, and the drop would break
 * them, or on PostgreSQL remove a key with the table. Any of them refuses
 * the whole drop, the column included: the column is what shows the table
 * is Nextly's on the next run.
 */
async function dropRefusal(
  db: unknown,
  dialect: SupportedDialect,
  objects: RetiredObjects
): Promise<string | null> {
  if (objects.column) {
    const remaining = await countItemsWithSizes(db, dialect);
    if (remaining > 0) {
      return `Dropped nothing: ${remaining} ${remaining === 1 ? "item still names its" : "items still name their"} image size files, which dropping the \`${RETIRED_SIZES_COLUMN}\` column would leave in storage with nothing pointing at them. Run \`${REMOVE_SIZES_COMMAND} --apply\` until it removes them all.`;
    }
  }
  if (objects.tableRows !== null) {
    const keys = await foreignKeysToImageSizes(db, dialect);
    if (keys.length > 0) {
      return `Dropped nothing: the \`${RETIRED_IMAGE_SIZES_TABLE}\` table has foreign keys from other tables (${keys.map(key => `${key.table}: ${key.name}`).join(", ")}), which dropping it would break. Drop or change those foreign keys, then run this again.`;
    }
  }
  const using = await schemaObjectsUsingRetired(db, dialect, objects);
  if (using.length > 0) {
    return `Dropped nothing: ${using.join("; ")}, which the drop would break. Drop or change ${using.length === 1 ? "it" : "them"}, then run this again.`;
  }
  return null;
}

/**
 * Drops the retired `image_sizes` table and the media table's `sizes` column,
 * each only where it is shown to be what image sizes left
 * (`readRetiredObjects`), and nothing while any media item still names a size
 * file. Says what it did, and why it kept anything, through `say`. Returns
 * the exit status: 1 when it refused or kept a table of that name, else 0.
 *
 * Run by `nextly media remove-sizes --apply --drop` once the size files are
 * gone, and by nothing else: `nextly migrate` runs before a new release takes
 * traffic, while the release before it still reads and writes both.
 *
 * The table goes first. It is shown to be Nextly's partly by the column beside
 * it, so a run that stops between the two leaves the column, and the next run
 * still recognises the table had it been left.
 */
export async function dropRetiredImageSizes(options: {
  db: unknown;
  dialect: SupportedDialect;
  executeSql: ExecuteSql;
  say: (line: string) => void;
}): Promise<number> {
  const { db, dialect, executeSql, say } = options;
  // Read afresh rather than taken from the removal's listing: an item can
  // have come to name size files since, and only now decides it.
  const objects = await readRetiredObjects(db, dialect);
  const refusal = await dropRefusal(db, dialect, objects);
  if (refusal !== null) {
    say(refusal);
    return 1;
  }
  const { generateSQL } = await import("../schema/pipeline/sql-templates");
  let code = 0;
  if (objects.keptTable !== null) {
    say(
      `Kept the \`${RETIRED_IMAGE_SIZES_TABLE}\` table: ${objects.keptTable}. Check it, and drop it yourself if it is the one image sizes left.`
    );
    code = 1;
  }
  if (objects.tableRows !== null) {
    // Never cascading, on any dialect: a foreign key that came to point at
    // the table after the check above makes the drop fail rather than go.
    await run(
      db,
      dialect,
      sql`DROP TABLE ${sql.identifier(RETIRED_IMAGE_SIZES_TABLE)}`
    );
    say(
      `Dropped the \`${RETIRED_IMAGE_SIZES_TABLE}\` table (${objects.tableRows} size ${objects.tableRows === 1 ? "definition" : "definitions"} nothing reads).`
    );
  }
  if (objects.column) {
    await executeSql(
      generateSQL(
        {
          type: "drop_column",
          tableName: "media",
          columnName: RETIRED_SIZES_COLUMN,
          columnType: LEGACY_SIZES_TYPE[dialect],
        },
        dialect
      )
    );
    say(
      `Dropped the \`media.${RETIRED_SIZES_COLUMN}\` column: no media item named a size file in it.`
    );
  }
  if (!objects.column && objects.tableRows === null && code === 0) {
    say(
      "Nothing to drop: neither the `sizes` column nor the `image_sizes` table is left."
    );
  }
  return code;
}
