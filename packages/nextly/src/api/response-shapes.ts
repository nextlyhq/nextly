/**
 * Canonical response-shape helpers for Phase 4. Every server handler
 * (dispatcher methods, REST endpoints, auth handlers, routeHandler
 * direct branches) converges on these instead of hand-rolling JSON.
 *
 * Contract lives in:
 *   docs/superpowers/specs/2026-05-01-phase-4-envelope-migration-design.md §5.1
 *
 * Six op-types:
 *   respondList     →  { items, meta }                    (paginated find)
 *   respondDoc      →  T (bare)                           (findByID)
 *   respondMutation →  { message, item }                  (create/update/delete)
 *   respondAction   →  { message, ...result }             (non-CRUD mutation)
 *   respondData     →  T (bare object)                    (non-CRUD read)
 *   respondCount    →  { total }                          (count)
 *
 * Errors do NOT use these helpers. Errors flow through `withErrorHandler`
 * (REST API) or the routeHandler error path (dispatcher API), both of
 * which emit Task 21's canonical singular `{ error: NextlyErrorJSON }`
 * shape. See docs §6.
 */

export type PaginationMeta = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  // Preserve caller-supplied headers, but default content-type to
  // application/json so individual call sites don't have to repeat it.
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers,
  });
}

/** Paginated list response. Body is `{ items, meta }`. */
export function respondList<T>(
  items: T[],
  meta: PaginationMeta,
  init?: ResponseInit
): Response {
  return jsonResponse({ items, meta }, init);
}

/** Bare-doc response. Body is the doc itself. Used for findByID. */
export function respondDoc<T>(doc: T, init?: ResponseInit): Response {
  return jsonResponse(doc, init);
}

/**
 * Mutation response. Body is `{ message, item }`. Default status 200;
 * pass `status: 201` for create operations.
 */
export function respondMutation<T>(
  message: string,
  item: T,
  init?: ResponseInit
): Response {
  return jsonResponse({ message, item }, init);
}

/**
 * Action / non-CRUD-mutation response. Body is `{ message, ...result }`.
 * Used for login, forgot-password, verify-email, seed, etc. — anywhere
 * we want to surface a server-authored toast string.
 *
 * `result` is optional so silent actions can call `respondAction("Logged out.")`.
 */
export function respondAction(
  message: string,
  result: Record<string, unknown> = {},
  init?: ResponseInit
): Response {
  return jsonResponse({ message, ...result }, init);
}

/**
 * Bare non-CRUD-read response. Body is the result object.
 * Used by /me/permissions, /admin-meta, /dashboard/stats, /health, etc.
 *
 * Constraint (spec §5.1 rule 3): callers must not pass Boolean-only
 * shapes like `{ ok: true }`. Always include at least one extra field
 * for future growth (e.g. `{ ok, version, uptime }`).
 */
export function respondData<T extends Record<string, unknown>>(
  result: T,
  init?: ResponseInit
): Response {
  return jsonResponse(result, init);
}

/** Count response. Body is `{ total }`. */
export function respondCount(total: number, init?: ResponseInit): Response {
  return jsonResponse({ total }, init);
}
