/**
 * Shared Pagination Normalizer
 *
 * Single source of truth for converting backend pagination metadata
 * to a consistent 0-based format for the UI table components.
 *
 * Handles all pagination shapes returned by backend services:
 * - Canonical: `{ total, page: 1, perPage }` (per spec §10.2, 1-based)
 * - Page-based legacy: `{ page: 1, pageSize, total, totalPages }` (1-based)
 * - Offset-based: `{ offset: 0, limit, total }` (offset/limit style)
 * - Missing meta: calculates from data array length
 */

export interface NormalizedPagination {
  /** 0-based page number for UI */
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function isCanonical(meta: Record<string, unknown>): meta is Record<
  string,
  unknown
> & {
  page: number;
  perPage: number;
  total: number;
} {
  return (
    typeof meta.page === "number" &&
    typeof meta.perPage === "number" &&
    typeof meta.total === "number"
  );
}

function isPageBased(meta: Record<string, unknown>): meta is Record<
  string,
  unknown
> & {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
} {
  return typeof meta.page === "number" && typeof meta.pageSize === "number";
}

function isOffsetBased(meta: Record<string, unknown>): meta is Record<
  string,
  unknown
> & {
  offset: number;
  limit: number;
  total: number;
} {
  return typeof meta.offset === "number" && typeof meta.limit === "number";
}

/**
 * Normalize backend pagination metadata to 0-based page format.
 *
 * @param meta - Raw pagination metadata from the API (or undefined if missing)
 * @param requestedPageSize - The page size requested by the client (fallback)
 * @param dataLength - Length of the data array (for fallback calculations)
 * @returns Normalized pagination with 0-based page number
 */
export function normalizePagination(
  meta: Record<string, unknown> | undefined,
  requestedPageSize: number,
  dataLength?: number
): NormalizedPagination {
  if (!meta) {
    const total = dataLength ?? 0;
    return {
      page: 0,
      pageSize: requestedPageSize,
      total,
      totalPages:
        requestedPageSize > 0 ? Math.ceil(total / requestedPageSize) : 0,
    };
  }

  // Canonical (spec §10.2): { total, page, perPage } — 1-based page.
  if (isCanonical(meta)) {
    return {
      page: Math.max(0, meta.page - 1),
      pageSize: meta.perPage,
      total: meta.total,
      totalPages: meta.perPage > 0 ? Math.ceil(meta.total / meta.perPage) : 0,
    };
  }

  // Page-based legacy: backend returns 1-based page → subtract 1
  if (isPageBased(meta)) {
    return {
      page: Math.max(0, meta.page - 1),
      pageSize: meta.pageSize,
      total: meta.total,
      totalPages: meta.totalPages,
    };
  }

  // Offset-based: convert offset to 0-based page number
  if (isOffsetBased(meta)) {
    const pageSize = meta.limit || requestedPageSize;
    return {
      page: pageSize > 0 ? Math.floor(meta.offset / pageSize) : 0,
      pageSize,
      total: meta.total,
      totalPages: pageSize > 0 ? Math.ceil(meta.total / pageSize) : 0,
    };
  }

  // Unknown shape: extract what we can
  const total = typeof meta.total === "number" ? meta.total : (dataLength ?? 0);
  return {
    page: 0,
    pageSize: requestedPageSize,
    total,
    totalPages:
      requestedPageSize > 0 ? Math.ceil(total / requestedPageSize) : 0,
  };
}
