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
