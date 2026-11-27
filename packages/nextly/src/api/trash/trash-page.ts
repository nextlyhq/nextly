/**
 * The pagination of a page of the trash, in the one shape every list
 * answers with (`PaginationMeta`), for REST and the Direct API alike.
 *
 * @module api/trash/trash-page
 */
import type { PaginationMeta } from "../response-shapes";

/** A page of the trash, as the service reads it. */
export interface TrashPage {
  total: number;
  page: number;
  limit: number;
}

export function paginationMetaOf(page: TrashPage): PaginationMeta {
  const totalPages = Math.max(Math.ceil(page.total / page.limit), 1);
  return {
    total: page.total,
    page: page.page,
    limit: page.limit,
    totalPages,
    hasNext: page.page < totalPages,
    hasPrev: page.page > 1,
  };
}
