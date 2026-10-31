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
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

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

/**
 * The stored `sizes` of the given items, while the column exists: what a
 * delete of those items reads to remove their size files too. Empty when the
 * column is gone.
 */
export async function storedSizesOf(
  db: unknown,
  dialect: SupportedDialect,
  ids: readonly string[]
): Promise<Map<string, unknown>> {
  const found = new Map<string, unknown>();
  if (ids.length === 0) return found;
  if (!(await hasRetiredSizesColumn(db, dialect))) return found;
  const rows = await rowsOf<{ id: string; sizes: unknown }>(
    db,
    dialect,
    sql`SELECT ${id}, ${sizes} FROM ${media} WHERE ${id} IN (${sql.join(
      ids.map(value => sql`${value}`),
      sql`, `
    )}) AND ${sizes} IS NOT NULL`
  );
  for (const row of rows) found.set(row.id, row.sizes);
  return found;
}

/** Runs one generated DDL statement. */
type ExecuteSql = (statement: string) => Promise<unknown>;

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
  if (objects.column) {
    const remaining = await countItemsWithSizes(db, dialect);
    if (remaining > 0) {
      say(
        `Dropped nothing: ${remaining} ${remaining === 1 ? "item still names its" : "items still name their"} image size files, which dropping the \`${RETIRED_SIZES_COLUMN}\` column would leave in storage with nothing pointing at them. Run \`${REMOVE_SIZES_COMMAND} --apply\` until it removes them all.`
      );
      return 1;
    }
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
    await executeSql(
      generateSQL(
        { type: "drop_table", tableName: RETIRED_IMAGE_SIZES_TABLE },
        dialect
      )
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
