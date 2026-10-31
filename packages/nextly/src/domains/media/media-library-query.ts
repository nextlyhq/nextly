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

/** The `media` columns the narrowing reads. */
export interface MediaQueryColumns {
  id: AnyColumn;
  folderId: AnyColumn;
  mimeType: AnyColumn;
  filename: AnyColumn;
  originalFilename: AnyColumn;
  altText: AnyColumn;
  caption: AnyColumn;
}

/** The usage table, as the `unused` view reads it. */
export type MediaUsageQueryTable = Table & { mediaId: AnyColumn };

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

/** An item no document uses, by the usage record's index on the item. */
export function unusedItem(
  media: MediaQueryColumns,
  usage: MediaUsageQueryTable
): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${usage} WHERE ${usage.mediaId} = ${media.id})`;
}

/**
 * The condition `filter` puts on the items, or `undefined` for every item.
 * `usage` is the usage table, or `null` before `nextly migrate` has created
 * it, when the `unused` view can say nothing and matches no item.
 */
export function mediaQueryCondition(
  media: MediaQueryColumns,
  usage: MediaUsageQueryTable | null,
  filter: MediaQueryFilter
): SQL | undefined {
  const conditions: SQL[] = [];
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
    conditions.push(usage ? unusedItem(media, usage) : sql`1 = 0`);
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** The sidebar's counts. */
export interface MediaLibraryCounts {
  /** Every item. */
  all: number;
  /** Images with no alt text. */
  missingAltText: number;
  /** Items no document uses; `null` before the usage table exists. */
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
