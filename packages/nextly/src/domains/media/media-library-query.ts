/**
 * What picks a page of the media library, said once for every reader of it:
 * the list, a folder's contents, and the counts beside the folders.
 *
 * A folder, a search, a type and a view each narrow the items; the list and a
 * folder's contents apply the same narrowing and page it in the database, and
 * the sidebar's counts are of the same views, so a count and the list it
 * stands for cannot disagree. The services load it when they read, not when
 * they are loaded; what a request may ask for is parsed at the boundary by
 * the schemas in `types/media`.
 *
 * @module domains/media/media-library-query
 */

import {
  and,
  or,
  sql,
  type AnyColumn,
  type SQL,
  type Table,
} from "drizzle-orm";

import type { MediaView } from "../../types/media";

import {
  DOCUMENT_MIME_TYPES,
  MEDIA_TYPE_PREFIXES,
  type MediaCategory,
} from "./media-categories";
import { PENDING_DELETE_KEY_PREFIX } from "./pending-delete";

/** The `media` columns the narrowing reads. */
export interface MediaQueryColumns {
  id: AnyColumn;
  folderId: AnyColumn;
  mimeType: AnyColumn;
  filename: AnyColumn;
  originalFilename: AnyColumn;
  altText: AnyColumn;
  caption: AnyColumn;
  /** The item's address, as the library gives it out. */
  url: AnyColumn;
}

/** The usage table, as the `unused` view reads it. */
export type MediaUsageQueryTable = Table & { mediaId: AnyColumn };

/**
 * A record outside content that keeps a media item chosen from the library by
 * its address: a user's avatar, the email brand's logo, the site's logos. The
 * usage record covers content alone, so the `unused` view asks each of these
 * as well, or it would offer a logo in use for deletion.
 */
export interface MediaAddressHolder {
  table: Table;
  /** Its columns that may hold an item's address. */
  columns: readonly AnyColumn[];
  /**
   * `exact` for a column holding the address as the library gave it out (an
   * avatar). `suffix` for one that may hold it made absolute against the
   * site (the email logo stores `https://site/uploads/a.png` for
   * `/uploads/a.png`), so a value ending in the address names the item: a
   * match too many keeps an item out of the view, never one in use in it.
   */
  match: "exact" | "suffix";
}

/** What decides which items are unused. */
export interface UnusedSources {
  usage: MediaUsageQueryTable;
  holders: readonly MediaAddressHolder[];
  /** How a value ending in another is asked, which differs by dialect. */
  dialect: "postgresql" | "mysql" | "sqlite";
}

/** What narrows a page of items. */
export interface MediaQueryFilter {
  /** A folder's id; `null` or "root" for the items in no folder. */
  folderId?: string | null;
  search?: string;
  /** A kind of file, as the library names it (`media-categories`). */
  type?: MediaCategory;
  view?: MediaView;
}

/** An image whose alt text is missing or blank. */
export function missingAltText(media: MediaQueryColumns): SQL {
  return sql`(${media.mimeType} LIKE ${"image/%"} AND (${media.altText} IS NULL OR TRIM(${media.altText}) = ${""}))`;
}

/** A MIME type that starts with `prefix`, which holds no LIKE wildcard. */
function mimeStartsWith(media: MediaQueryColumns, prefix: string): SQL {
  return sql`${media.mimeType} LIKE ${`${prefix}%`}`;
}

/** The items of one kind of file, as `mediaCategoryOf` names each item. */
function mediaCategoryCondition(
  media: MediaQueryColumns,
  category: MediaCategory
): SQL {
  const named = Object.entries(MEDIA_TYPE_PREFIXES) as Array<
    [MediaCategory, string]
  >;
  const document = or(
    ...DOCUMENT_MIME_TYPES.exact.map(type => sql`${media.mimeType} = ${type}`),
    ...DOCUMENT_MIME_TYPES.prefixes.map(prefix => mimeStartsWith(media, prefix))
  ) as SQL;
  if (category === "document") {
    // An image's type is never a document's, so the order of the checks
    // `mediaCategoryOf` makes does not change which items this is.
    return document;
  }
  const prefix = named.find(([name]) => name === category)?.[1];
  if (prefix !== undefined) return mimeStartsWith(media, prefix);
  // What no kind names, a missing type included.
  return or(
    sql`${media.mimeType} IS NULL`,
    sql`NOT (${or(...named.map(([, p]) => mimeStartsWith(media, p)), document)})`
  ) as SQL;
}

/** Whether `value` ends in `suffix`, each a column, on `dialect`. */
function endsWith(
  value: AnyColumn,
  suffix: AnyColumn,
  dialect: UnusedSources["dialect"]
): SQL {
  if (dialect === "postgresql") {
    return sql`RIGHT(${value}, LENGTH(${suffix})) = ${suffix}`;
  }
  if (dialect === "mysql") {
    // MySQL's LENGTH counts bytes; RIGHT counts characters.
    return sql`RIGHT(${value}, CHAR_LENGTH(${suffix})) = ${suffix}`;
  }
  return sql`SUBSTR(${value}, -LENGTH(${suffix})) = ${suffix}`;
}

/** Whether one holder keeps the item. */
function heldBy(
  media: MediaQueryColumns,
  holder: MediaAddressHolder,
  dialect: UnusedSources["dialect"]
): SQL {
  const names = holder.columns.map(column =>
    holder.match === "exact"
      ? sql`${column} = ${media.url}`
      : endsWith(column, media.url, dialect)
  );
  return sql`EXISTS (SELECT 1 FROM ${holder.table} WHERE ${or(...names)})`;
}

/**
 * An item no document uses, by the usage record's index on the item, and no
 * record outside content keeps by its address.
 */
export function unusedItem(
  media: MediaQueryColumns,
  sources: UnusedSources
): SQL {
  const { usage } = sources;
  const notRecorded = sql`NOT EXISTS (SELECT 1 FROM ${usage} WHERE ${usage.mediaId} = ${media.id})`;
  const held = sources.holders.map(
    holder => sql`NOT ${heldBy(media, holder, sources.dialect)}`
  );
  return and(notRecorded, ...held) as SQL;
}

/**
 * An item no one has deleted inside the Undo window: one with no
 * `media.deleting:<id>` mark in `nextly_meta`. Every library read applies it,
 * so a deleted item leaves the list, a folder, the views and the counts at
 * once while its row and files wait for the window to end. The mark's key is
 * matched from its own side (`SUBSTR`, which every dialect has) rather than
 * built from the item's id, since the dialects join strings differently.
 */
export function notPendingDelete(media: Pick<MediaQueryColumns, "id">): SQL {
  // Under an alias of its own, since the counting query also joins
  // `nextly_meta` for another row.
  const meta = sql.identifier("nextly_meta");
  const mark = sql.identifier("pending_mark");
  const key = sql.identifier("key");
  const idStart = sql.raw(String(PENDING_DELETE_KEY_PREFIX.length + 1));
  return sql`NOT EXISTS (SELECT 1 FROM ${meta} ${mark} WHERE ${mark}.${key} LIKE ${`${PENDING_DELETE_KEY_PREFIX}%`} AND SUBSTR(${mark}.${key}, ${idStart}) = ${media.id})`;
}

/**
 * The condition `filter` puts on the items: never one deleted inside the
 * Undo window ({@link notPendingDelete}).
 * `unused` is what the `unused` view reads, or `null` before `nextly migrate`
 * has created the usage table, when the view can say nothing and matches no
 * item.
 */
export function mediaQueryCondition(
  media: MediaQueryColumns,
  unused: UnusedSources | null,
  filter: MediaQueryFilter
): SQL | undefined {
  const conditions: SQL[] = [notPendingDelete(media)];
  if (filter.folderId !== undefined) {
    conditions.push(
      filter.folderId === null || filter.folderId === "root"
        ? sql`${media.folderId} IS NULL`
        : sql`${media.folderId} = ${filter.folderId}`
    );
  }
  if (filter.search) {
    // LOWER() on both sides, for a search without regard to case on every
    // dialect.
    const pattern = `%${filter.search.toLowerCase()}%`;
    const search = or(
      sql`LOWER(${media.filename}) LIKE ${pattern}`,
      sql`LOWER(${media.originalFilename}) LIKE ${pattern}`,
      sql`LOWER(${media.altText}) LIKE ${pattern}`,
      sql`LOWER(${media.caption}) LIKE ${pattern}`
    );
    if (search) conditions.push(search);
  }
  if (filter.type) {
    conditions.push(mediaCategoryCondition(media, filter.type));
  }
  if (filter.view === "missing-alt") conditions.push(missingAltText(media));
  if (filter.view === "unused") {
    conditions.push(unused ? unusedItem(media, unused) : sql`1 = 0`);
  }
  return and(...conditions);
}

/** The sidebar's counts. */
export interface MediaLibraryCounts {
  /** Every item. */
  all: number;
  /** Images with no alt text. */
  missingAltText: number;
  /**
   * Items no document uses and no avatar or logo keeps; `null` before the
   * usage table exists.
   */
  unused: number | null;
  /**
   * Whether the usage record has been built for content written before it
   * existed. Until it has, `unused` can count an item that content uses.
   */
  usageRecorded: boolean;
  /** The items in no folder. */
  root: number;
  /** Each folder's own items (not its subfolders'), by the folder's id. */
  folders: Record<string, number>;
}

/** One group of the counting query: one folder's items. */
export interface MediaCountGroup {
  folderId: unknown;
  items: number | string | null;
  missingAlt: number | string | null;
  unused: number | string | null;
  recorded: number | string | null;
}

/**
 * The counts from the counting query's groups. A dialect returns a sum as a
 * number or as a string (MySQL's DECIMAL, PostgreSQL's BIGINT), so each is
 * read as a number. A library with no items has nothing to count and nothing
 * to be unused, so its record is complete.
 */
export function mediaLibraryCountsOf(
  groups: readonly MediaCountGroup[],
  usagePresent: boolean
): MediaLibraryCounts {
  const counts: MediaLibraryCounts = {
    all: 0,
    missingAltText: 0,
    unused: usagePresent ? 0 : null,
    usageRecorded: usagePresent,
    root: 0,
    folders: {},
  };
  for (const group of groups) addGroup(counts, group);
  return counts;
}

/** One folder's group, added to the counts. */
function addGroup(counts: MediaLibraryCounts, group: MediaCountGroup): void {
  const items = Number(group.items ?? 0);
  counts.all += items;
  counts.missingAltText += Number(group.missingAlt ?? 0);
  if (counts.unused !== null) counts.unused += Number(group.unused ?? 0);
  if (Number(group.recorded ?? 0) !== 1) counts.usageRecorded = false;
  if (typeof group.folderId === "string") {
    counts.folders[group.folderId] = items;
  } else {
    counts.root += items;
  }
}
