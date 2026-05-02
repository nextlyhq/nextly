/**
 * Canonical response-shape helpers for Phase 4. Every server handler
 * (dispatcher methods, REST endpoints, auth handlers, routeHandler
 * direct branches) converges on these instead of hand-rolling JSON.
 *
 * Contract lives in:
 *   docs/superpowers/specs/2026-05-01-phase-4-envelope-migration-design.md section 5.1
 *
 * Eight op-types:
 *   respondList         to { items, meta }                   (paginated find)
 *   respondDoc          to T (bare)                          (findByID)
 *   respondMutation     to { message, item }                 (create/update/delete)
 *   respondAction       to { message, ...result }            (non-CRUD mutation)
 *   respondData         to T (bare object)                   (non-CRUD read)
 *   respondCount        to { total }                         (count)
 *   respondBulk         to { message, items, errors }        (bulk by id, Phase 4.5)
 *   respondBulkUpload   to { message, items, errors }        (bulk upload, Phase 4.5)
 *
 * Errors do NOT use these helpers. Errors flow through `withErrorHandler`
 * (REST API) or the routeHandler error path (dispatcher API), both of
 * which emit Task 21's canonical singular `{ error: NextlyErrorJSON }`
 * shape. See docs section 6.
 *
 * Note on bulk vs. error: respondBulk / respondBulkUpload are NOT errors.
 * A bulk request always succeeds at the request layer (HTTP 200) so long
 * as the request itself is well-formed; per-item failures are first-class
 * data in the body's `errors` array. 4xx is reserved for malformed bulk
 * requests (e.g. empty `ids` array) where the dispatcher's pre-check
 * throws NextlyError.validation BEFORE entering the service.
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

// ────────────────────────────────────────────────────────────────────────
// Bulk shapes (Phase 4.5).
//
// Two distinct types because the per-item failure key differs:
//   - id-keyed ops (bulk delete by ids, bulk update by ids, bulk update by
//     query): the client supplied an id per item, so failures echo `id`.
//   - upload-style ops (bulk media upload): the client supplied positional
//     entries with no pre-assigned id. Forcing `id?: string` would be a
//     workaround; we model the positional case honestly with `index` +
//     `filename` (filename for UX context only, not a primary key).
//
// Per-item error code is the same canonical NextlyErrorCode enum the
// single-item code path uses (NOT_FOUND, FORBIDDEN, VALIDATION_ERROR,
// CONFLICT, INTERNAL_ERROR, ...). `message` is public-safe per spec
// section 13.8: generic per-code, no identifier echo, no value leaking.
// Specifics ride to the operator log via the dispatcher logger.
// ────────────────────────────────────────────────────────────────────────

export type PerItemError = {
  /** Identifier of the item that failed (matches the request's input id). */
  id: string;
  /** Canonical NextlyErrorCode value. */
  code: string;
  /** Public-safe message. No identifier echo, no value leaking. */
  message: string;
};

export type BulkUploadError = {
  /** Positional index in the original request payload. */
  index: number;
  /** Filename from the input. UX context only, not an identifier. */
  filename: string;
  /** Canonical NextlyErrorCode value. */
  code: string;
  /** Public-safe message. No identifier echo, no value leaking. */
  message: string;
};

/**
 * Bulk-by-id response. Body is `{ message, items, errors }`. Status 200.
 *
 * - `items`: successes. For delete this is `{ id: string }[]` (the records
 *   are gone, so no point shipping them back); for update/create this is
 *   the full mutated records (the client needs the latest values without
 *   a re-fetch).
 * - `errors`: per-item failures. Always present, even when empty, so
 *   consumers can iterate predictably.
 */
export function respondBulk<T>(
  message: string,
  items: T[],
  errors: PerItemError[],
  init?: ResponseInit
): Response {
  return jsonResponse({ message, items, errors }, init);
}

/**
 * Bulk-upload response. Body is `{ message, items, errors }`. Status 200.
 *
 * Same body shape as respondBulk, but `errors[]` items are positional
 * (`{ index, filename, code, message }`) rather than id-keyed. Failed
 * uploads have no id by construction, so id-keying would be dishonest.
 */
export function respondBulkUpload<T>(
  message: string,
  items: T[],
  errors: BulkUploadError[],
  init?: ResponseInit
): Response {
  return jsonResponse({ message, items, errors }, init);
}
