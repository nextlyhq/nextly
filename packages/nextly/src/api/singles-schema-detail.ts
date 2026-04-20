/**
 * Singles Schema Detail API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * individual Single schema management endpoints at /api/singles/[slug]/schema.
 *
 * This is separate from the document endpoints (/api/singles/[slug]) which
 * handle the actual content/values of a Single.
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/singles/[slug]/schema/route.ts
 * export { GET, PATCH, DELETE } from '@revnixhq/nextly/api/singles-schema-detail';
 * ```
 *
 * @module api/singles-schema-detail
 */

import { getService } from "../di";
import { calculateSchemaHash } from "../domains/schema/services/schema-hash";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import type { ComponentRegistryService } from "../services/components/component-registry-service";
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
 * Get the SingleRegistryService from the DI container.
 */
async function getSingleRegistry(): Promise<SingleRegistryService> {
  await ensureServicesInitialized();
  return getService("singleRegistryService");
}

/**
 * Get the ComponentRegistryService from the DI container.
 */
async function getComponentRegistry(): Promise<ComponentRegistryService> {
  await ensureServicesInitialized();
  return getService("componentRegistryService");
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
  console.error(`[Singles Schema Detail API] ${operation} error:`, error);

  if (isServiceError(error)) {
    // Map FORBIDDEN to LOCKED for locked Single errors
    const code = error.code === "FORBIDDEN" ? "LOCKED" : error.code;
    return errorResponse(error.message, error.httpStatus, code);
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
 * GET handler for retrieving a Single's schema/metadata by slug.
 *
 * Requires authentication.
 *
 * Response Codes:
 * - 200 OK: Single schema retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Single with slug does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch Single
 *
 * @param request - Next.js Request object
 * @param context - Route context with params Promise containing slug
 * @returns Response with JSON Single schema data
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer <token>" \
 *   "http://localhost:3000/api/singles/site-settings/schema"
 * # => {"data":{"slug":"site-settings","label":"Site Settings","fields":[...],...}}
 * ```
 */
export async function GET(
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
    const registry = await getSingleRegistry();
    const single = await registry.getSingle(slug);

    // Enrich component fields with inline schemas for Admin UI
    // This allows form rendering without extra API calls per component
    // Type is Record<string, unknown>[] to allow EnrichedFieldConfig properties
    let enrichedFields: Record<string, unknown>[] =
      single.fields as unknown as Record<string, unknown>[];
    try {
      const componentRegistry = await getComponentRegistry();
      enrichedFields = await componentRegistry.enrichFieldsWithComponentSchemas(
        single.fields as unknown as Record<string, unknown>[]
      );
    } catch (enrichError) {
      // Log but don't fail — return unenriched fields if component registry unavailable
      console.warn(
        "[Singles Schema Detail API] Failed to enrich component fields:",
        enrichError
      );
    }

    // Return single with enriched fields (fields may have additional componentFields/componentSchemas properties)
    // Cast through unknown to allow Record<string, unknown>[] in place of FieldConfig[]
    return successResponse({
      ...single,
      fields: enrichedFields,
    } as unknown as typeof single);
  } catch (error) {
    return handleError(error, "Get Single schema");
  }
}

/**
 * PATCH handler for updating a Single's schema/metadata.
 *
 * Requires authentication. Returns 403 Forbidden if Single is locked
 * (code-first Singles cannot be modified via API).
 *
 * Request Body (all fields optional):
 * - label: string
 * - description: string
 * - fields: Array of field configurations
 * - admin: Admin UI configuration object
 *
 * Response Codes:
 * - 200 OK: Single updated successfully
 * - 400 Bad Request: Invalid JSON body
 * - 401 Unauthorized: Authentication required
 * - 403 Forbidden: Single is locked (code-first)
 * - 404 Not Found: Single with slug does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Update failed
 *
 * @param request - Next.js Request object with JSON body
 * @param context - Route context with params Promise containing slug
 * @returns Response with JSON updated Single
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/singles/site-settings/schema', {
 *   method: 'PATCH',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({
 *     label: 'Global Site Settings',
 *     fields: [...updatedFields],
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
    const registry = await getSingleRegistry();

    // Parse request body
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
    }

    // Build update data - only include fields that are present
    const updateData: Record<string, unknown> = {};

    if (body.label !== undefined) {
      updateData.label = body.label;
    }

    if (body.description !== undefined) {
      updateData.description = body.description;
    }

    if (body.fields !== undefined) {
      updateData.fields = body.fields;
      // Recalculate schema hash when fields change
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateData.schemaHash = calculateSchemaHash(body.fields as any);
    }

    // Admin fields: support both nested admin object and flat top-level fields.
    // The registry's updateSingle expects data.admin as a merged object.
    const ADMIN_KEYS = [
      "icon",
      "group",
      "order",
      "sidebarGroup",
      "hidden",
    ] as const;

    const adminOverrides: Record<string, unknown> = {};
    if (body.admin !== undefined) {
      const admin = body.admin as Record<string, unknown>;
      for (const key of ADMIN_KEYS) {
        if (admin[key] !== undefined) {
          adminOverrides[key] = admin[key];
        }
      }
    }
    // Flat top-level fields take precedence
    for (const key of ADMIN_KEYS) {
      if (body[key] !== undefined) {
        adminOverrides[key] = body[key];
      }
    }

    // If any admin fields changed, merge with existing admin and set as a whole object
    if (Object.keys(adminOverrides).length > 0) {
      const existing = await registry.getSingle(slug);
      updateData.admin = {
        ...(existing.admin || {}),
        ...adminOverrides,
      };
    }

    if (body.accessRules !== undefined) {
      updateData.accessRules = body.accessRules;
    }

    // Update Single (source: "ui" to enforce locking rules)
    const updated = await registry.updateSingle(slug, updateData, {
      source: "ui",
    });

    return successResponse(updated);
  } catch (error) {
    return handleError(error, "Update Single schema");
  }
}

/**
 * DELETE handler for removing a Single.
 *
 * Requires authentication. Returns 403 Forbidden if Single is locked
 * (code-first Singles cannot be deleted via API).
 *
 * Note: Singles require `force: true` to delete as they represent
 * persistent site-wide configuration.
 *
 * Response Codes:
 * - 204 No Content: Single deleted successfully
 * - 401 Unauthorized: Authentication required
 * - 403 Forbidden: Single is locked (code-first)
 * - 404 Not Found: Single with slug does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Deletion failed
 *
 * @param request - Next.js Request object
 * @param context - Route context with params Promise containing slug
 * @returns Empty response with 204 status on success
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/singles/site-settings/schema', {
 *   method: 'DELETE',
 *   headers: {
 *     'Authorization': 'Bearer <token>',
 *   },
 * });
 * // response.status === 204 on success
 * ```
 */
export async function DELETE(
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
    const registry = await getSingleRegistry();

    // Singles require force: true to delete
    await registry.deleteSingle(slug, { force: true });

    // Return 204 No Content on successful deletion
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleError(error, "Delete Single");
  }
}
