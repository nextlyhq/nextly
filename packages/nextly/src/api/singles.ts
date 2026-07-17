/**
 * Singles API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * Singles listing endpoints at /api/singles.
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/singles/route.ts
 * export { GET } from 'nextly/api/singles';
 * ```
 *
 * @module api/singles
 */

import { getService } from "../di";
import { getCachedNextly } from "../init";
import { withTimezoneFormatting } from "../lib/date-formatting";
import type { SingleRegistryService } from "../services/singles/single-registry-service";

import { respondList } from "./response-shapes";
import { requireRoutePermission } from "./route-auth";
import { withErrorHandler } from "./with-error-handler";

async function getSingleRegistry(): Promise<SingleRegistryService> {
  await getCachedNextly();
  return getService("singleRegistryService");
}

/**
 * GET handler for listing Singles with pagination and filters.
 *
 * Requires manage-settings, matching the dispatcher's `listSingles`
 * authorization — this lists Single definitions (builder surface), not
 * their published content.
 *
 * Query Parameters:
 * - source: Filter by source type ("code" | "ui" | "built-in")
 * - search: Search query for slug and labels
 * - limit: Maximum results (default: 50, becomes `meta.limit` in response)
 * - offset: Number of results to skip (default: 0, derives `page` in meta)
 * - page: 1-based page number. Alternative to `offset`; `offset` wins when
 *   both are provided.
 *
 * Response:
 * - 200 OK: `{ "items": [...], "meta": { total, page, limit, totalPages, hasNext, hasPrev } }`
 * - On error: `application/problem+json` per spec §10.1.
 */
export const GET = withErrorHandler(
  async (request: Request): Promise<Response> => {
    await requireRoutePermission(request, "manage", "settings");

    const registry = await getSingleRegistry();
    const { searchParams } = new URL(request.url);

    const source = searchParams.get("source") as
      | "code"
      | "ui"
      | "built-in"
      | null;
    const search = searchParams.get("search") || undefined;

    // Parse query params through `Number.isFinite` so empty (`?offset=`),
    // non-numeric (`?limit=abc`), and negative (`?offset=-5`) values all
    // collapse to the safe default instead of forwarding `NaN` / negative
    // numbers into the registry. The previous `parseInt(...)` direct-assign
    // for `offset` regressed on empty-string values: `parseInt("", 10)`
    // returns `NaN`, which then poisoned the pagination meta downstream.
    const limitParam = searchParams.get("limit");
    const parsedLimit =
      limitParam !== null ? parseInt(limitParam, 10) : Number.NaN;
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;

    // `offset` is the canonical skip count; `page` is the 1-based
    // alternative. A valid `offset` wins; otherwise we try `page`; otherwise
    // we default to 0. Invalid values for either are treated as "absent" so
    // a client serializing optional params as empty strings still gets sane
    // behaviour instead of a NaN-poisoned response.
    const offsetParam = searchParams.get("offset");
    const pageParam = searchParams.get("page");
    const parsedOffset =
      offsetParam !== null ? parseInt(offsetParam, 10) : Number.NaN;
    const parsedPage =
      pageParam !== null ? parseInt(pageParam, 10) : Number.NaN;
    let offset = 0;
    if (Number.isFinite(parsedOffset) && parsedOffset >= 0) {
      offset = parsedOffset;
    } else if (Number.isFinite(parsedPage) && parsedPage > 0 && limit > 0) {
      offset = (parsedPage - 1) * limit;
    }

    const result = await registry.listSingles({
      source: source || undefined,
      search,
      limit,
      offset,
    });

    // Translate offset-based pagination to the canonical page/limit meta so
    // every paginated route ships the same shape (spec §5.1). `safeLimit` is
    // clamped to a minimum of 1 to keep the page-derivation safe when the
    // caller asks for `limit=0`.
    const safeLimit = Math.max(1, limit);
    const page = Math.floor(offset / safeLimit) + 1;
    const totalPages = Math.ceil(result.total / safeLimit);
    return withTimezoneFormatting(
      respondList(result.data, {
        total: result.total,
        page,
        limit: safeLimit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      })
    );
  }
);
