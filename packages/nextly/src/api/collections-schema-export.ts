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
 * @example
 * ```typescript
 * // In your Next.js app: app/api/collections/schema/[slug]/export/route.ts
 * export { GET } from '@revnixhq/nextly/api/collections-schema-export';
 * ```
 *
 * @module api/collections-schema-export
 */

import { getSession } from "../auth/session";
import { getService } from "../di";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import { env } from "../lib/env";
import { CollectionExportService } from "../services/collections/collection-export-service";
import type { CollectionRegistryService } from "../services/collections/collection-registry-service";
import { hasPermission, isSuperAdmin } from "../services/lib/permissions";

/**
 * Context object for dynamic route handlers.
 * Next.js 15+ requires params to be a Promise.
 */
interface RouteContext {
  params: Promise<{ slug: string }>;
}

async function getCollectionRegistry(): Promise<CollectionRegistryService> {
  await getNextly();
  return getService("collectionRegistryService");
}

function successResponse<T>(data: T, statusCode: number = 200): Response {
  return Response.json(
    { data },
    {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function errorResponse(
  message: string,
  statusCode: number = 500,
  code?: string
): Response {
  return Response.json(
    {
      error: {
        message,
        ...(code && { code }),
      },
    },
    {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function handleError(error: unknown, operation: string): Response {
  console.error(`[Collections Schema Export API] ${operation} error:`, error);

  if (isServiceError(error)) {
    return errorResponse(error.message, error.httpStatus, error.code);
  }

  if (error instanceof Error) {
    if (error.message.includes("Services not initialized")) {
      return errorResponse(error.message, 503, "SERVICE_UNAVAILABLE");
    }
    return errorResponse(error.message, 500);
  }

  return errorResponse(`Failed to ${operation.toLowerCase()}`, 500);
}

async function checkAuthentication(
  request: Request
): Promise<{ userId: string } | Response> {
  // getSession returns GetSessionResult; extract user or null for backward compat
  const result = await getSession(request, env.NEXTLY_SECRET_RESOLVED || "");
  const user = result.authenticated ? result.user : null;
  if (!user) {
    return errorResponse("Authentication required", 401, "UNAUTHORIZED");
  }
  return { userId: user.id };
}

/**
 * GET handler for exporting a collection to code-first format.
 *
 * Requires authentication and read permission for the collection.
 * Generates `defineCollection()` code from the collection's field configuration.
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
 * - 403 Forbidden: User does not have read permission for this collection
 * - 404 Not Found: Collection with slug does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Export failed
 *
 * @param request - Next.js Request object
 * @param context - Route context with params Promise containing slug
 * @returns Response with JSON containing generated code, or file download
 *
 * @example
 * ```typescript
 * // Get as JSON (default)
 * const response = await fetch('/api/collections/schema/blog_posts/export', {
 *   headers: { 'Authorization': 'Bearer <token>' },
 * });
 * const { data: { code } } = await response.json();
 *
 * // Get as downloadable TypeScript file
 * const response = await fetch(
 *   '/api/collections/schema/blog_posts/export?download=true',
 *   { headers: { 'Authorization': 'Bearer <token>' } }
 * );
 * // Triggers file download: blog_posts.ts
 *
 * // Get as JavaScript without placeholders
 * const response = await fetch(
 *   '/api/collections/schema/blog_posts/export?format=javascript&includeAccess=false&includeHooks=false',
 *   { headers: { 'Authorization': 'Bearer <token>' } }
 * );
 * ```
 */
export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const authResult = await checkAuthentication(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    const { userId } = authResult;
    const { slug } = await context.params;

    const isAdmin = await isSuperAdmin(userId);
    if (!isAdmin) {
      const canRead = await hasPermission(userId, "read", slug);
      if (!canRead) {
        return errorResponse(
          `Forbidden: you do not have read permission for collection '${slug}'`,
          403,
          "FORBIDDEN"
        );
      }
    }

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

      return new Response(code, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    return successResponse({ code });
  } catch (error) {
    return handleError(error, "Export collection");
  }
}
