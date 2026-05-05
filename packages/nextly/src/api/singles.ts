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
 * export { GET } from '@revnixhq/nextly/api/singles';
 * ```
 *
 * @module api/singles
 */

import { getService } from "../di";
import { getCachedNextly } from "../init";
import { withTimezoneFormatting } from "../lib/date-formatting";
import type { SingleRegistryService } from "../services/singles/single-registry-service";

import { respondList } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

async function getSingleRegistry(): Promise<SingleRegistryService> {
  await getCachedNextly();
  return getService("singleRegistryService");
}

/**
 * GET handler for listing Singles with pagination and filters.
 *
 * Query Parameters:
 * - source: Filter by source type ("code" | "ui" | "built-in")
 * - search: Search query for slug and labels
 * - limit: Maximum results (default: 50, becomes `meta.limit` in response)
 * - offset: Number of results to skip (default: 0, derives `page` in meta)
 *
 * Response:
 * - 200 OK: `{ "items": [...], "meta": { total, page, limit, totalPages, hasNext, hasPrev } }`
 * - On error: `application/problem+json` per spec §10.1.
 */
export const GET = withErrorHandler(
  async (request: Request): Promise<Response> => {
    const registry = await getSingleRegistry();
    const { searchParams } = new URL(request.url);

    const source = searchParams.get("source") as
      | "code"
      | "ui"
      | "built-in"
      | null;
    const search = searchParams.get("search") || undefined;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!, 10)
      : 50;
    const offset = searchParams.get("offset")
      ? parseInt(searchParams.get("offset")!, 10)
      : 0;

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
