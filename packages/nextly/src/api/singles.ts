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
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import { withTimezoneFormatting } from "../lib/date-formatting";
import type { SingleRegistryService } from "../services/singles/single-registry-service";

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get the SingleRegistryService from the DI container.
 * Uses getNextly() to ensure services are initialized with config.
 */
async function getSingleRegistry(): Promise<SingleRegistryService> {
  await getNextly();
  return getService("singleRegistryService");
}

/**
 * Create a success response with data and optional meta
 */
function successResponse<T>(
  data: T,
  statusCode: number = 200,
  meta?: Record<string, unknown>
): Response {
  return Response.json(
    {
      data,
      ...(meta && { meta }),
    },
    {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * Create an error response
 */
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

/**
 * Handle errors from service layer
 */
function handleError(error: unknown, operation: string): Response {
  console.error(`[Singles API] ${operation} error:`, error);

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

// ============================================================
// Route Handlers
// ============================================================

/**
 * GET handler for listing Singles with pagination and filters.
 *
 * Query Parameters:
 * - source: Filter by source type ("code" | "ui" | "built-in")
 * - search: Search query for slug and labels
 * - limit: Maximum results (default: 50)
 * - offset: Number of results to skip (default: 0)
 *
 * Response Codes:
 * - 200 OK: Singles list retrieved successfully
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch Singles
 *
 * @param request - Next.js Request object
 * @returns Response with JSON Singles list and pagination meta
 *
 * @example
 * ```bash
 * curl "http://localhost:3000/api/singles?source=ui&limit=10"
 * # => {"data":[...],"meta":{"total":5,"limit":10,"offset":0}}
 * ```
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const registry = await getSingleRegistry();
    const { searchParams } = new URL(request.url);

    // Parse query parameters
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

    return withTimezoneFormatting(
      successResponse(result.data, 200, {
        total: result.total,
        limit,
        offset,
      })
    );
  } catch (error) {
    return handleError(error, "List Singles");
  }
}
