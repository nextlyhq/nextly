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
 * Wire shape — Task 21 migration: handlers wrap `withErrorHandler` and return
 * the canonical `{ data: [...], meta: { total, page, perPage } }` envelope per
 * spec §10.2. Errors flow through the wrapper and serialize as
 * `application/problem+json`.
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

import { createPaginatedResponse } from "./create-success-response";
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
 * - limit: Maximum results (default: 50, becomes `perPage` in response meta)
 * - offset: Number of results to skip (default: 0, derives `page` in meta)
 *
 * Response:
 * - 200 OK: `{ "data": [...], "meta": { total, page, perPage } }`
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

    // Translate offset-based pagination to the canonical page/perPage meta so
    // every paginated route ships the same shape (spec §10.2). `perPage` is
    // clamped to a minimum of 1 to keep the page-derivation safe when the
    // caller asks for `limit=0`.
    const perPage = Math.max(1, limit);
    const page = Math.floor(offset / perPage) + 1;
    return withTimezoneFormatting(
      createPaginatedResponse(result.data, {
        total: result.total,
        page,
        perPage,
      })
    );
  }
);
