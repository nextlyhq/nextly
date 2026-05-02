/**
 * Canonical response shape types for admin consumers (Phase 4).
 *
 * Mirrors `packages/nextly/src/api/response-shapes.ts` on the server so
 * service modules and hooks can type their fetcher returns directly:
 *
 *   const result = await fetcher<ListResponse<User>>("/users");
 *   const users = result.items;
 *   const totalPages = result.meta.totalPages;
 *
 * Contract reference:
 *   docs/superpowers/specs/2026-05-01-phase-4-envelope-migration-design.md §5.1
 *
 * For findByID and non-CRUD reads, the response is a bare `T` — no wrapper
 * type needed. Just `fetcher<User>(...)` or `fetcher<{ permissions, ... }>(...)`.
 */

export type PaginationMeta = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

/** Paginated list response. Matches server's `respondList(items, meta)`. */
export type ListResponse<T> = {
  items: T[];
  meta: PaginationMeta;
};

/** Mutation response. Matches server's `respondMutation(message, item)`. */
export type MutationResponse<T> = {
  message: string;
  item: T;
};

/**
 * Action / non-CRUD-mutation response. Matches server's
 * `respondAction(message, result)`. Generic over `R` to capture
 * endpoint-specific extras (login tokens, seed counts, etc.).
 */
export type ActionResponse<R = Record<string, unknown>> = {
  message: string;
} & R;

/** Count response. Matches server's `respondCount(total)`. */
export type CountResponse = {
  total: number;
};

/**
 * Per-item failure entry inside a `BulkResponse<T>` (Phase 4.5).
 *
 * `code` is a canonical NextlyErrorCode value (`NOT_FOUND`, `FORBIDDEN`,
 * `VALIDATION_ERROR`, `CONFLICT`, `INTERNAL_ERROR`, etc.) so the admin
 * UI can branch on it the same way it does for single-item errors.
 * `message` is the public-safe NextlyError.publicMessage (no identifier
 * echo; specifics live on the server in `logContext`).
 */
export type PerItemError = {
  id: string;
  code: string;
  message: string;
};

/**
 * Per-item failure entry inside a `BulkUploadResponse<T>` (Phase 4.5).
 *
 * Distinct from `PerItemError` because failed uploads do not have an id
 * (the record was never created). The canonical key is `index`, the
 * positional offset in the input array; `filename` is included for UX
 * so the admin can render "couldn't upload <filename>" without lookup.
 */
export type BulkUploadError = {
  index: number;
  filename: string;
  code: string;
  message: string;
};

/**
 * Bulk response for operations on existing records keyed by id.
 *
 * Matches server's `respondBulk(message, items, errors)`. Status is
 * always 200 even on partial success: per-item failures are first-class
 * data in `errors[]`, not server errors. Generic over `T` because the
 * delete path returns `T = { id: string }` (no point materializing the
 * full record after delete) while update/create return the full record
 * (so the admin can refresh local state without a re-fetch).
 */
export type BulkResponse<T> = {
  message: string;
  items: T[];
  errors: PerItemError[];
};

/**
 * Bulk response for upload-style operations creating new records from
 * positional input. Matches server's `respondBulkUpload(message, items, errors)`.
 *
 * Distinct from `BulkResponse<T>` because failure entries are keyed by
 * `index` + `filename`, not `id` (the record never got created). Same
 * partial-success semantics: HTTP 200 with `errors[]` carrying failures.
 */
export type BulkUploadResponse<T> = {
  message: string;
  items: T[];
  errors: BulkUploadError[];
};

/**
 * Error response shape (canonical Task 21 §10.1). Both `withErrorHandler`
 * and the dispatcher path emit this shape after Phase 4. The admin client's
 * `parseApiError.ts` already reads this shape; no client work needed beyond
 * deleting the obsolete "Non-canonical error response" warning eventually.
 */
export type ErrorResponse = {
  error: {
    code: string;
    message: string;
    messageKey?: string;
    data?: Record<string, unknown>;
    requestId: string;
  };
};
