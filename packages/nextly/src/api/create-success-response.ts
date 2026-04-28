/**
 * Canonical success-response helpers for `@revnixhq/nextly/api`. Routes
 * wrap their handler in `withErrorHandler` and return one of these. All
 * success responses match the spec §10.2 wire format: `{ "data": ... }`
 * for single resources, `{ "data": [...], "meta": {...} }` for paginated
 * lists.
 *
 * `Content-Type: application/json` is set unless the caller's headers
 * already specify one.
 */

export type PaginationMeta = {
  total: number;
  page: number;
  perPage: number;
};

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return headers;
}

export function createSuccessResponse<T>(
  data: T,
  opts?: { status?: number; headers?: HeadersInit }
): Response {
  return new Response(JSON.stringify({ data }), {
    status: opts?.status ?? 200,
    headers: buildHeaders(opts?.headers),
  });
}

export function createPaginatedResponse<T>(
  data: T[],
  meta: PaginationMeta,
  opts?: { status?: number; headers?: HeadersInit }
): Response {
  return new Response(JSON.stringify({ data, meta }), {
    status: opts?.status ?? 200,
    headers: buildHeaders(opts?.headers),
  });
}
