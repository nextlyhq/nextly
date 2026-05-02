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

/**
 * @deprecated Phase 4 follow-up: prefer the canonical respond helpers in
 * `./response-shapes` (`respondDoc`, `respondMutation`, `respondAction`,
 * `respondData`, `respondCount`). Phase 4 (Tasks 6-23) migrated every
 * collection / single / auth / dashboard endpoint, but ~27 non-Phase-4
 * endpoints (uploads, media, collections-schema, email-providers,
 * email-templates, user-fields, components, image-sizes, storage-upload-url)
 * still call this helper because their shape semantics were out of scope.
 * Tracked for a Phase 4.5+ followup. The helper is retained until those
 * endpoints are migrated; once they are, delete it along with this file.
 */
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
