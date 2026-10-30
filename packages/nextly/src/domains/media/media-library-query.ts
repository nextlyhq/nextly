/**
 * What picks a page of the media library, said once for every reader of it:
 * the list, a folder's contents, and the counts beside the folders.
 *
 * A folder, a search, a type and a view each narrow the items; the list and a
 * folder's contents apply the same narrowing and page it in the database, and
 * the sidebar's counts are of the same views, so a count and the list it
 * stands for cannot disagree.
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
import { z } from "zod";

import { MediaTypeSchema } from "../../types/media";

/**
 * The views beside the folders. `missing-alt` is the images with no alt text;
 * `unused` is the items the usage record finds no document using.
 */
const MEDIA_VIEWS = ["missing-alt", "unused"] as const;
export type MediaView = (typeof MEDIA_VIEWS)[number];

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
  /** A kind of file: the first part of its type, such as "image". */
  type?: string;
  view?: MediaView;
}

/** An image whose alt text is missing or blank. */
export function missingAltText(media: MediaQueryColumns): SQL {
  return sql`(${media.mimeType} LIKE ${"image/%"} AND (${media.altText} IS NULL OR TRIM(${media.altText}) = ${""}))`;
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
    conditions.push(sql`${media.mimeType} LIKE ${`${filter.type}/%`}`);
  }
  if (filter.view === "missing-alt") conditions.push(missingAltText(media));
  if (filter.view === "unused") {
    conditions.push(usage ? unusedItem(media, usage) : sql`1 = 0`);
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * A page of a folder's items as a request asks for it, parsed at the
 * boundary. Bounds as the list's own: at most 100 items a page.
 */
export const mediaPageQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(24),
  search: z.string().trim().min(1).optional(),
  type: MediaTypeSchema.optional(),
  sortBy: z.enum(["uploadedAt", "filename", "size"]).default("uploadedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
export type MediaPageQuery = z.infer<typeof mediaPageQuerySchema>;

/** The views a request may name, parsed at the boundary. */
export const mediaViewSchema = z.enum(MEDIA_VIEWS);

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
