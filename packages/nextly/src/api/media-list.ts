/**
 * The media list's query and its answer, said once for both list handlers
 * (`media-handlers`, the mounted one, and the superseded `media`): what a
 * request's query asks for, and the canonical list envelope for the page the
 * service read.
 *
 * @module api/media-list
 */

import type {
  ListMediaOptions,
  MediaListPage,
} from "../domains/media/services/media-service";

import { respondList } from "./response-shapes";

/**
 * The most media items one read by id names: a page of the library, so a
 * request stays a bounded read however many images a page draws (a caller
 * with more asks again).
 */
export const MEDIA_IDS_PER_READ = 100;

/**
 * The ids a list request names, as `?ids=a,b` or a repeated `?ids=`; nothing
 * where it names none, and the list is the paged one. Raw: the caller checks
 * them before the read.
 */
export function mediaIdsAskedIn(
  searchParams: URLSearchParams
): string[] | undefined {
  const asked = searchParams.getAll("ids");
  if (asked.length === 0) return undefined;
  return asked.flatMap(value => value.split(",")).filter(id => id !== "");
}

/**
 * The list envelope for the items a read by id found: one page holding all
 * of them, in the order their ids were asked.
 */
export function mediaByIdsResponse(found: readonly unknown[]): Response {
  return respondList([...found], {
    total: found.length,
    page: 1,
    limit: Math.max(1, found.length),
    totalPages: found.length === 0 ? 0 : 1,
    hasNext: false,
    hasPrev: false,
  });
}

/** The page, search, type, folder and sort a list request's query names. */
export function listMediaOptionsFrom(
  searchParams: URLSearchParams
): ListMediaOptions {
  const folderIdParam = searchParams.get("folderId");
  return {
    page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : 24,
    search: searchParams.get("search") || undefined,
    type: (searchParams.get("type") as ListMediaOptions["type"]) || undefined,
    folderId: folderIdParam === "root" ? "root" : folderIdParam || undefined,
    sortBy:
      (searchParams.get("sortBy") as ListMediaOptions["sortBy"]) ||
      "uploadedAt",
    sortOrder:
      (searchParams.get("sortOrder") as ListMediaOptions["sortOrder"]) ||
      "desc",
  };
}

/**
 * The list envelope for `result`, the page `options` asked for. Unused's
 * page alone also says whether the usage record it was read from was
 * complete (`usageRecorded`), which is what the admin lists that view on.
 */
export function mediaListResponse(
  result: MediaListPage,
  options: ListMediaOptions
): Response {
  const page = options.page ?? 1;
  const limit = Math.max(1, options.limit ?? 24);
  const total = result.pagination.total;
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return respondList(result.data, {
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    ...(result.usageRecorded === undefined
      ? {}
      : { usageRecorded: result.usageRecorded }),
  });
}
