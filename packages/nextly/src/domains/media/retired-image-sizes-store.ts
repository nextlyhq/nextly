/**
 * Reading and clearing the retired `sizes` column, and finding the retired
 * `image_sizes` table, in a database that may or may not still have them.
 *
 * Neither is in Nextly's Drizzle definitions any more: a new install never
 * gets them, and a database that has run `nextly migrate` after the size files
 * were removed no longer has them. So every read here names them through
 * Drizzle's `sql` template with quoted identifiers, and asks first whether they
 * are there rather than assuming it from the version.
 *
 * @module domains/media/retired-image-sizes-store
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import { NextlyError } from "../../errors/nextly-error";

import {
  holdsStoredSizes,
  type MediaSizesRow,
  type RetiredObjects,
  type RetiredSizesStore,
} from "./retired-image-sizes";
import {
  RETIRED_IMAGE_SIZES_TABLE,
  RETIRED_SIZES_COLUMN,
} from "./retired-image-sizes-constants";

/** Rows read per page, so a large library is never held in one result. */
const PAGE = 500;

/**
 * The columns the retired `image_sizes` table was created with, beyond `id`.
 * A table of that name without all of them is not Nextly's and is left alone:
 * a host app sharing the database can have its own.
 */
const RETIRED_TABLE_SHAPE = [
  "name",
  "width",
  "height",
  "fit",
  "quality",
  "format",
  "is_default",
  "sort_order",
] as const;

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
 * Whether the media table still has its `sizes` column, asked of the
 * database's catalogue. A catalogue read never fails for a missing column, so
 * asking cannot abort a PostgreSQL transaction the caller is inside.
 */
export async function hasRetiredSizesColumn(
  db: unknown,
  dialect: SupportedDialect
): Promise<boolean> {
  const statement =
    dialect === "sqlite"
      ? sql`SELECT name FROM pragma_table_info('media') WHERE name = ${RETIRED_SIZES_COLUMN}`
      : dialect === "mysql"
        ? sql`SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'media' AND column_name = ${RETIRED_SIZES_COLUMN}`
        : sql`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'media' AND column_name = ${RETIRED_SIZES_COLUMN}`;
  return (await rowsOf(db, dialect, statement)).length > 0;
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
 * How many media items still name size files: the number `nextly migrate`
 * keeps the column for, and the startup notice reports. Read in pages of the
 * rows whose `sizes` is not NULL, and judged as the removal judges them, so an
 * empty object counts as none and a value that cannot be read counts as some.
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
 * The retired `image_sizes` table's row count, or null when the database has
 * no table of that name with the shape Nextly created it with.
 */
export async function retiredImageSizesTableRows(
  db: unknown,
  dialect: SupportedDialect,
  columnsOf: (table: string) => Promise<string[]>
): Promise<number | null> {
  const columns = new Set(await columnsOf(RETIRED_IMAGE_SIZES_TABLE));
  if (!RETIRED_TABLE_SHAPE.every(column => columns.has(column))) return null;
  const [row] = await rowsOf<{ count: number | string }>(
    db,
    dialect,
    sql`SELECT COUNT(*) AS ${sql.identifier("count")} FROM ${sql.identifier(RETIRED_IMAGE_SIZES_TABLE)}`
  );
  return Number(row?.count ?? 0);
}

/** What is left of the retired column and table, read from the database. */
export async function readRetiredObjects(
  db: unknown,
  dialect: SupportedDialect,
  columnsOf: (table: string) => Promise<string[]>
): Promise<RetiredObjects & { itemsWithSizes: number }> {
  const column = await hasRetiredSizesColumn(db, dialect);
  return {
    column,
    itemsWithSizes: column ? await countItemsWithSizes(db, dialect) : 0,
    tableRows: await retiredImageSizesTableRows(db, dialect, columnsOf),
  };
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
