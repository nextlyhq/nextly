/**
 * Shared dispatcher helpers for translating service-result envelopes
 * to canonical response shapes.
 *
 * What these helpers do: nextly's older service layer (collections,
 * singles, forms, users, auth) returns results in the envelope shape
 * `{ success, statusCode, data, message }`. The newer pattern is to
 * throw NextlyError directly and return bare data. Until every service
 * is rewritten to the newer pattern, dispatchers translate at the
 * boundary: success branches hand bare data to respondX; failures throw
 * a canonical NextlyError so the dispatcher's error path emits the
 * spec §5.1 error envelope.
 *
 * What these helpers are NOT: a backward-compat shim for client code.
 * Nothing here lets old admin clients keep working with old wire
 * shapes. The wire is fully canonical. This file only crosses the
 * service-to-dispatcher boundary inside the package.
 *
 * Future deletion: when the underlying services are rewritten to throw
 * NextlyError directly, every translator here becomes dead code and
 * this file can be removed. Until then, it stays as the canonical
 * boundary translator.
 *
 * Helpers exported:
 *
 * - `toPaginationMeta`: services returning
 *   `{total, page, limit, totalPages}` (most metadata-style services).
 * - `paginatedResponseToMeta`: entry-query service's Payload-style shape
 *   (`totalDocs`, `hasNextPage`, etc.).
 * - `offsetPaginationToMeta`: Singles + Components registries that use
 *   limit/offset semantics.
 * - `unwrapServiceResult`: the `{success, statusCode, message, data}`
 *   envelope unwrap plus status-to-NextlyError mapping.
 */

import type { PaginationMeta } from "../../api/response-shapes";
import { NextlyError } from "../../errors/nextly-error";

/**
 * Translate the service-result `{ total, page, limit, totalPages }`
 * shape (used by user/auth/collection metadata services) into the
 * canonical PaginationMeta. Service-internal and wire field names are
 * unified on `limit`, so this helper just derives `hasNext`/`hasPrev`
 * from page math.
 */
export function toPaginationMeta(meta: {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}): PaginationMeta {
  return {
    total: meta.total,
    page: meta.page,
    limit: meta.limit,
    totalPages: meta.totalPages,
    hasNext: meta.page < meta.totalPages,
    hasPrev: meta.page > 1,
  };
}

/**
 * Translate the entry-query service's Payload-style PaginatedResponse
 * (`{ totalDocs, limit, page, totalPages, hasNextPage, hasPrevPage }`)
 * into canonical PaginationMeta. We keep this as a separate helper from
 * `toPaginationMeta` because the field set differs enough that bending
 * one shape into the other would be more confusing than two small
 * translators.
 */
export function paginatedResponseToMeta(p: {
  totalDocs: number;
  limit: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}): PaginationMeta {
  return {
    total: p.totalDocs,
    page: p.page,
    limit: p.limit,
    totalPages: p.totalPages,
    hasNext: p.hasNextPage,
    hasPrev: p.hasPrevPage,
  };
}

/**
 * Translate Singles + Components registries' `{ total, limit?, offset? }`
 * triple into canonical PaginationMeta. Synthesizes a 1-based page number
 * from the offset so the wire shape matches every other dispatcher.
 *
 * Falls back to a single-page response when limit is unset (limit defaults
 * to total or 1). This matches the existing behavior in single-dispatcher
 * before consolidation; do not change without auditing every Singles list
 * caller, since the registry contract treats `limit === 0` as "all rows".
 */
export function offsetPaginationToMeta(args: {
  total: number;
  limit?: number;
  offset?: number;
}): PaginationMeta {
  const total = args.total;
  const limit = args.limit && args.limit > 0 ? args.limit : total || 1;
  const offset = args.offset ?? 0;
  const page = Math.floor(offset / limit) + 1;
  const totalPages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  return {
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Unwrap a `{ success, statusCode, message, data }` service envelope
 * and throw a NextlyError on failure. Migrated dispatch handlers use
 * this so the wire path matches the canonical contract: success
 * branches hand bare data to respondX, failures throw and the
 * dispatcher catch block builds the canonical `{ error: NextlyErrorJSON }`
 * response.
 *
 * The legacy `message` rides through `logContext.legacyMessage` so
 * operator logs still carry the original service text. The wire response
 * sees only the canonical NextlyError publicMessage (per spec §13.8:
 * no driver text, no identifier echo, no value leaking).
 *
 * Status-to-NextlyError mapping:
 *   400: NextlyError.validation (with publicData.errors[])
 *   403: NextlyError.forbidden
 *   404: NextlyError.notFound
 *   409: NextlyError.conflict
 *   500 + everything else: NextlyError.internal
 *
 * The `data?: unknown` parameter accepts any service-result shape (the
 * legacy services are mostly generic-untyped, so callers always know
 * more about the success-shape than the result type carries). Callers
 * pass T explicitly to declare the expected success shape; `data as T`
 * is the canonical cast at the boundary. The success-branch contract
 * guarantees `data` is non-null when `success === true` (the metadata,
 * entry, and singles services never return null on success), so the
 * cast is safe.
 */
export function unwrapServiceResult<T>(
  result: {
    success: boolean;
    statusCode?: number;
    message?: string;
    data?: unknown;
  },
  logContext?: Record<string, unknown>
): T {
  if (result.success) {
    return result.data as T;
  }
  const status = result.statusCode ?? 500;
  const ctx = { legacyMessage: result.message, ...logContext };
  if (status === 404) throw NextlyError.notFound({ logContext: ctx });
  if (status === 403) throw NextlyError.forbidden({ logContext: ctx });
  if (status === 409) throw NextlyError.conflict({ logContext: ctx });
  if (status === 400) {
    throw NextlyError.validation({
      errors: [
        {
          path: "request",
          code: "INVALID",
          message: "The submitted data is invalid.",
        },
      ],
      logContext: ctx,
    });
  }
  throw NextlyError.internal({ logContext: ctx });
}
