/**
 * Canonical response-shape helpers. Every server handler (dispatcher
 * methods, REST endpoints, auth handlers, routeHandler direct branches)
 * converges on these instead of hand-rolling JSON.
 *
 * Contract lives in the envelope spec, section 5.1.
 *
 * Eight op-types:
 *   respondList         to { items, meta }                   (paginated find)
 *   respondDoc          to T (bare)                          (findByID)
 *   respondMutation     to { message, item, warnings? }      (create/update/delete)
 *   respondAction       to { message, warnings?, ...result } (non-CRUD mutation)
 *   respondData         to T (bare object)                   (non-CRUD read)
 *   respondCount        to { total }                         (count)
 *   respondBulk         to { message, items, errors, warnings? } (bulk by id)
 *   respondBulkUpload   to { message, items, errors, warnings? } (bulk upload)
 *
 * Errors do NOT use these helpers. Errors flow through `withErrorHandler`
 * (REST API) or the routeHandler error path (dispatcher API), both of
 * which emit the canonical singular `{ error: NextlyErrorJSON }` shape.
 * See docs section 6.
 *
 * Note on bulk vs. error: respondBulk / respondBulkUpload are NOT errors.
 * A bulk request always succeeds at the request layer (HTTP 200) so long
 * as the request itself is well-formed; per-item failures are first-class
 * data in the body's `errors` array. 4xx is reserved for malformed bulk
 * requests (e.g. empty `ids` array) where the dispatcher's pre-check
 * throws NextlyError.validation BEFORE entering the service.
 */

import { currentSideEffectWarnings } from "../hooks/side-effect-warnings";

export type PaginationMeta = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

/**
 * Set on a response whose body is CONFIGURATION rather than records.
 *
 * The route handler rewrites date-looking strings in every payload by value, to
 * present stored timestamps in the installation's timezone. A definition or a
 * descriptor is not stored data: a field default that merely resembles a date
 * would be rewritten, so the value delivered would stop matching the value
 * registered and would differ between installations. Marked responses are
 * passed through untouched, and the header is stripped before it reaches a
 * client.
 */
export const SKIP_DATE_FORMATTING_HEADER = "x-nextly-skip-date-formatting";

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
  // A post-commit hook failure reports success with a warning: the row is
  // durable and a side-effect phase cannot change it, so failing the operation
  // would tell the caller its write did not happen and invite a retry that
  // writes it twice. Read here rather than passed in, because the failures are
  // raised deep in the write path and every one of this helper's call sites
  // would otherwise have to accept and forward them.
  //
  // Omitted entirely when empty, so the ordinary body is unchanged.
  const warnings = currentSideEffectWarnings();
  return jsonResponse(
    warnings.length > 0 ? { message, item, warnings } : { message, item },
    init
  );
}

/**
 * Action / non-CRUD-mutation response. Body is `{ message, ...result }`.
 * Used for login, forgot-password, verify-email, seed, etc.; anywhere a
 * server-authored toast string is needed.
 *
 * `result` is optional so silent actions can call `respondAction("Logged out.")`.
 */
export function respondAction(
  message: string,
  result: Record<string, unknown> = {},
  init?: ResponseInit
): Response {
  // Some actions ARE writes: a version restore calls the ordinary update path,
  // so its post-commit hooks run and can fail. Reporting a durable restore as
  // an unqualified success would hide exactly the side effect this reports.
  //
  // A caller-supplied `warnings` key wins, so an action that computes its own
  // is not overwritten by the ambient ones.
  const warnings = currentSideEffectWarnings();
  return jsonResponse(
    warnings.length > 0
      ? { message, warnings, ...result }
      : { message, ...result },
    init
  );
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
// Bulk shapes.
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
  // Same rule as `respondMutation`: a hook that failed after the write
  // committed is reported beside the result rather than turned into an error.
  // `errors` is per-ITEM and means that item did not happen; `warnings` is
  // per-OPERATION and means every item happened and a side effect did not.
  const warnings = currentSideEffectWarnings();
  return jsonResponse(
    warnings.length > 0
      ? { message, items, errors, warnings }
      : { message, items, errors },
    init
  );
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
  // Same rule as `respondMutation`: a hook that failed after the write
  // committed is reported beside the result rather than turned into an error.
  // `errors` is per-ITEM and means that item did not happen; `warnings` is
  // per-OPERATION and means every item happened and a side effect did not.
  const warnings = currentSideEffectWarnings();
  return jsonResponse(
    warnings.length > 0
      ? { message, items, errors, warnings }
      : { message, items, errors },
    init
  );
}
