/**
 * Singles Detail API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * individual Single management endpoints at /api/singles/[slug].
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/singles/[slug]/route.ts
 * export { GET, PATCH } from '@revnixhq/nextly/api/singles-detail';
 * ```
 *
 * @module api/singles-detail
 */

import { getService } from "../di";
import { container } from "../di/container";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import { withTimezoneFormatting } from "../lib/date-formatting";
import { transformRichTextFields } from "../lib/field-transform";
import type { RichTextOutputFormat } from "../lib/rich-text-html";
import type { SingleEntryService } from "../services/singles/single-entry-service";
import type { SingleRegistryService } from "../services/singles/single-registry-service";

// ============================================================
// Types
// ============================================================

/**
 * Context object for dynamic route handlers.
 * Next.js 15+ requires params to be a Promise.
 */
interface RouteContext {
  params: Promise<{ slug: string }>;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Ensure services are initialized with config.
 */
async function ensureServicesInitialized(): Promise<void> {
  await getNextly();
}

/**
 * Get the SingleEntryService from the DI container.
 */
async function getSingleEntryService(): Promise<SingleEntryService> {
  await ensureServicesInitialized();
  return getService("singleEntryService");
}

/**
 * Get the SingleRegistryService from the DI container.
 */
async function getSingleRegistry(): Promise<SingleRegistryService> {
  await ensureServicesInitialized();
  return getService("singleRegistryService");
}

/**
 * Create a success response with data
 */
function successResponse<T>(data: T, statusCode: number = 200): Response {
  return Response.json(
    { data },
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
  console.error(`[Singles Detail API] ${operation} error:`, error);

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

/**
 * Check for authentication header.
 * Returns error response if not authenticated, null if authenticated.
 */
function checkAuthentication(request: Request): Response | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse("Authentication required", 401, "UNAUTHORIZED");
  }
  // TODO: Validate the auth token and extract user ID
  // For now, we accept any Authorization header as authenticated
  return null;
}

// ============================================================
// Route Handlers
// ============================================================

/**
 * Valid output formats for rich text fields.
 */
const VALID_RICH_TEXT_FORMATS = ["json", "html", "both"] as const;

/**
 * Parse and validate the richTextFormat query parameter.
 */
function parseRichTextFormat(value: string | null): RichTextOutputFormat {
  if (!value) return "json";
  const normalized = value.toLowerCase();
  if (VALID_RICH_TEXT_FORMATS.includes(normalized as RichTextOutputFormat)) {
    return normalized as RichTextOutputFormat;
  }
  return "json";
}

/**
 * GET handler for retrieving a Single document by slug.
 *
 * This is a public endpoint - no authentication required.
 * If the Single document doesn't exist, it will be auto-created with default field values.
 *
 * Query Parameters:
 * - depth: Relationship expansion depth (reserved for future use)
 * - locale: Locale for localized fields (reserved for future use)
 * - richTextFormat: Output format for rich text fields ("json" | "html" | "both")
 *   - "json" (default): Return Lexical JSON structure only
 *   - "html": Return HTML string only
 *   - "both": Return object with both { json, html } properties
 *
 * Response Codes:
 * - 200 OK: Single document retrieved successfully
 * - 404 Not Found: Single with slug does not exist in registry
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch Single
 *
 * @param request - Next.js Request object
 * @param context - Route context with params Promise containing slug
 * @returns Response with JSON Single document data
 *
 * @example
 * ```bash
 * # Get Single with default JSON format for rich text
 * curl "http://localhost:3000/api/singles/site-settings"
 *
 * # Get Single with HTML format for rich text fields
 * curl "http://localhost:3000/api/singles/site-settings?richTextFormat=html"
 *
 * # Get Single with both JSON and HTML for rich text fields
 * curl "http://localhost:3000/api/singles/site-settings?richTextFormat=both"
 * # => {"data":{"id":"...","content":{"json":{...},"html":"<p>...</p>"}}}
 * ```
 */
export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    // Public endpoint - no authentication required for reading Singles
    const { slug } = await context.params;
    const service = await getSingleEntryService();

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const depth = searchParams.get("depth")
      ? parseInt(searchParams.get("depth")!, 10)
      : undefined;
    const locale = searchParams.get("locale") || undefined;
    const richTextFormat = parseRichTextFormat(
      searchParams.get("richTextFormat")
    );

    // Get Single document (auto-creates if not exists)
    const result = await service.get(slug, { depth, locale });

    if (!result.success) {
      return errorResponse(
        result.message || "Single not found",
        result.statusCode,
        result.statusCode === 404 ? "NOT_FOUND" : undefined
      );
    }

    // Transform rich text fields if format is not "json" (default)
    let responseData = result.data;
    if (richTextFormat !== "json" && result.data) {
      // Get the Single's field configuration for transformation
      const registry = await getSingleRegistry();
      const single = await registry.getSingleBySlug(slug);

      if (single?.fields && Array.isArray(single.fields)) {
        responseData = transformRichTextFields(
          result.data as Record<string, unknown>,
          single.fields,
          richTextFormat
        ) as typeof result.data;
      }
    }

    return withTimezoneFormatting(successResponse(responseData));
  } catch (error) {
    return handleError(error, "Get Single");
  }
}

/**
 * PATCH handler for updating a Single document.
 *
 * Requires authentication. If the Single document doesn't exist,
 * it will be auto-created first, then updated with the provided data.
 *
 * Note: Singles cannot be deleted. They represent persistent site-wide
 * configuration that always exists once accessed.
 *
 * Request Body:
 * - Any fields defined in the Single schema
 * - System fields (id, createdAt) are ignored if included
 *
 * Response Codes:
 * - 200 OK: Single document updated successfully
 * - 400 Bad Request: Invalid JSON body
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Single with slug does not exist in registry
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Update failed
 *
 * @param request - Next.js Request object with JSON body
 * @param context - Route context with params Promise containing slug
 * @returns Response with JSON updated Single document
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/singles/site-settings', {
 *   method: 'PATCH',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({
 *     siteName: 'My Awesome Site',
 *     tagline: 'Building the future',
 *   }),
 * });
 * const { data: updated } = await response.json();
 * ```
 */
export async function PATCH(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    // Check authentication
    const authError = checkAuthentication(request);
    if (authError) {
      return authError;
    }

    const { slug } = await context.params;
    const service = await getSingleEntryService();

    // Parse request body
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
    }

    // Parse query parameters for locale
    const { searchParams } = new URL(request.url);
    const locale = searchParams.get("locale") || undefined;

    // Update Single document
    const result = await service.update(slug, body, { locale });

    if (!result.success) {
      return errorResponse(
        result.message || "Update failed",
        result.statusCode,
        result.statusCode === 404 ? "NOT_FOUND" : undefined
      );
    }

    return withTimezoneFormatting(successResponse(result.data));
  } catch (error) {
    return handleError(error, "Update Single");
  }
}

/**
 * GET handler for retrieving Single schema/metadata by slug.
 *
 * This endpoint returns the Single's schema configuration, not the document data.
 * Useful for Admin UI to understand the field structure.
 *
 * Requires authentication.
 *
 * Response Codes:
 * - 200 OK: Single schema retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Single with slug does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch schema
 *
 * @param request - Next.js Request object
 * @param slug - Single slug from URL
 * @returns Response with JSON Single schema
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer <token>" \
 *   "http://localhost:3000/api/singles/site-settings/schema"
 * # => {"data":{"slug":"site-settings","label":"Site Settings","fields":[...]}}
 * ```
 */
export async function getSchema(
  request: Request,
  slug: string
): Promise<Response> {
  try {
    // Check authentication
    const authError = checkAuthentication(request);
    if (authError) {
      return authError;
    }

    const registry = await getSingleRegistry();
    const single = await registry.getSingleBySlug(slug);

    if (!single) {
      return errorResponse(`Single '${slug}' not found`, 404, "NOT_FOUND");
    }

    return successResponse(single);
  } catch (error) {
    return handleError(error, "Get Single schema");
  }
}
