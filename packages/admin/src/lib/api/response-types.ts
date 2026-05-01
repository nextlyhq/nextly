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
