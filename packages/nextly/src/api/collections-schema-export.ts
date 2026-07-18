/**
 * Collection Schema Export API Route Handler for Next.js
 *
 * This route handler can be re-exported in your Next.js application to provide
 * collection export endpoints at /api/collections/schema/[slug]/export.
 *
 * Exports UI-created collections to code-first format (defineCollection syntax)
 * for version control and customization.
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * The JSON path returns `{ code }` via `respondData`; the `?download=true`
 * path returns the raw code as `text/plain` with a `Content-Disposition`
 * attachment header (binary/text-stream responses bypass JSON envelopes).
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/collections/schema/[slug]/export/route.ts
 * export { GET } from 'nextly/api/collections-schema-export';
 * ```
 *
 * @module api/collections-schema-export
 */

import { getService } from "../di";
import { getCachedNextly } from "../init";
import { CollectionExportService } from "../services/collections/collection-export-service";
import type { CollectionRegistryService } from "../services/collections/collection-registry-service";

import { respondData } from "./response-shapes";
import { requireRouteCollectionAccess } from "./route-auth";
import { withErrorHandler } from "./with-error-handler";

/**
 * Context object for dynamic route handlers.
 * Next.js 15+ requires params to be a Promise.
 */
interface RouteContext {
  params: Promise<{ slug: string }>;
}

async function getCollectionRegistry(): Promise<CollectionRegistryService> {
  await getCachedNextly();
  return getService("collectionRegistryService");
}

/**
 * GET handler for exporting a collection to code-first format.
 *
 * Requires authentication and read permission for the collection.
 * Generates `defineCollection()` code from the collection's field config.
 *
 * Query Parameters:
 * - includeAccess: Include access control placeholder comments (default: true)
 * - includeHooks: Include hooks placeholder comments (default: true)
 * - format: Output format - "typescript" or "javascript" (default: "typescript")
 * - download: If "true", returns as downloadable file instead of JSON
 *
 * Response Codes:
 * - 200 OK: Code generated successfully (JSON or file download)
 * - 401 Unauthorized: Authentication required
 * - 403 Forbidden: Caller lacks read permission for this collection
 * - 404 Not Found: Collection with slug does not exist
 * - 500 Internal Server Error: Export failed
 */
export const GET = withErrorHandler(
  async (request: Request, context: RouteContext) => {
    const { slug } = await context.params;
    await requireRouteCollectionAccess(request, "read", slug);

    const registry = await getCollectionRegistry();
    const collection = await registry.getCollection(slug);

    const { searchParams } = new URL(request.url);
    const includeAccessPlaceholders =
      searchParams.get("includeAccess") !== "false";
    const includeHooksPlaceholders =
      searchParams.get("includeHooks") !== "false";
    const format =
      (searchParams.get("format") as "typescript" | "javascript") ||
      "typescript";
    const download = searchParams.get("download") === "true";

    const exportService = new CollectionExportService();
    const code = exportService.exportToCode(collection, {
      includeAccessPlaceholders,
      includeHooksPlaceholders,
      format,
    });

    if (download) {
      const extension = format === "typescript" ? ".ts" : ".js";
      const filename = `${slug}${extension}`;

      // Binary/text-stream responses bypass the JSON envelope helpers so the
      // body is the raw code rather than the JSON envelope.
      // `withErrorHandler` still sets `X-Request-Id` on the way out.
      return new Response(code, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    return respondData({ code });
  }
);
