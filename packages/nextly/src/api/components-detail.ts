/**
 * Components Detail API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * individual component management endpoints at /api/components/[slug].
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/components/[slug]/route.ts
 * export { GET, PATCH, DELETE } from '@revnixhq/nextly/api/components-detail';
 * ```
 *
 * @module api/components-detail
 */

import { getService } from "../di";
import { calculateSchemaHash } from "../domains/schema/services/schema-hash";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import type { ComponentRegistryService } from "../services/components/component-registry-service";

/**
 * Context object for dynamic route handlers.
 * Next.js 15+ requires params to be a Promise.
 */
interface RouteContext {
  params: Promise<{ slug: string }>;
}

async function getComponentRegistry(): Promise<ComponentRegistryService> {
  await getNextly();
  return getService("componentRegistryService");
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
  console.error(`[Components Detail API] ${operation} error:`, error);

  if (isServiceError(error)) {
    // Map FORBIDDEN to LOCKED for locked component errors
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

function checkAuthentication(request: Request): Response | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse("Authentication required", 401, "UNAUTHORIZED");
  }
  // TODO: Validate the auth token and extract user ID
  // For now, we accept any Authorization header as authenticated
  return null;
}

/**
 * GET handler for retrieving a single component by slug.
 *
 * Requires authentication.
 *
 * Response Codes:
 * - 200 OK: Component retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Component with slug does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch component
 *
 * @param request - Next.js Request object
 * @param context - Route context with params Promise containing slug
 * @returns Response with JSON component data
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer <token>" \
 *   "http://localhost:3000/api/components/seo"
 * # => {"data":{"slug":"seo","label":"SEO Metadata","fields":[...],...}}
 * ```
 */
export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const authError = checkAuthentication(request);
    if (authError) {
      return authError;
    }

    const { slug } = await context.params;
    const registry = await getComponentRegistry();
    const component = await registry.getComponent(slug);

    return successResponse(component);
  } catch (error) {
    return handleError(error, "Get component");
  }
}

/**
 * PATCH handler for updating a component.
 *
 * Requires authentication. Returns 403 Forbidden if component is locked
 * (code-first components cannot be modified via API).
 *
 * Request Body (all fields optional):
 * - label: Display name
 * - description: Component description
 * - fields: Array of field configurations
 * - admin: Admin UI configuration object
 *
 * Response Codes:
 * - 200 OK: Component updated successfully
 * - 400 Bad Request: Invalid JSON body
 * - 401 Unauthorized: Authentication required
 * - 403 Forbidden: Component is locked (code-first)
 * - 404 Not Found: Component with slug does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Update failed
 *
 * @param request - Next.js Request object with JSON body
 * @param context - Route context with params Promise containing slug
 * @returns Response with JSON updated component
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/components/seo', {
 *   method: 'PATCH',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({
 *     label: 'SEO Settings',
 *     fields: [...updatedFields],
 *     admin: { category: 'Meta' },
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
    const authError = checkAuthentication(request);
    if (authError) {
      return authError;
    }

    const { slug } = await context.params;
    const registry = await getComponentRegistry();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
    }

    const updateData: Record<string, unknown> = {};

    if (body.label !== undefined) {
      updateData.label = body.label;
    }

    if (body.description !== undefined) {
      updateData.description = body.description;
    }

    if (body.fields !== undefined) {
      updateData.fields = body.fields;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateData.schemaHash = calculateSchemaHash(body.fields as any);
    }

    if (body.admin !== undefined) {
      updateData.admin = body.admin;
    }

    // Update component (source: "ui" to enforce locking rules)
    const updated = await registry.updateComponent(slug, updateData, {
      source: "ui",
    });

    return successResponse(updated);
  } catch (error) {
    return handleError(error, "Update component");
  }
}

/**
 * DELETE handler for removing a component.
 *
 * Requires authentication. Returns 403 Forbidden if component is locked
 * (code-first components cannot be deleted via API).
 *
 * Returns 409 Conflict if the component is referenced by any Collection,
 * Single, or other Component (delete protection).
 *
 * Response Codes:
 * - 204 No Content: Component deleted successfully
 * - 401 Unauthorized: Authentication required
 * - 403 Forbidden: Component is locked (code-first)
 * - 404 Not Found: Component with slug does not exist
 * - 409 Conflict: Component is referenced by other entities
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Deletion failed
 *
 * @param request - Next.js Request object
 * @param context - Route context with params Promise containing slug
 * @returns Empty response with 204 status on success
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/components/seo', {
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
    const authError = checkAuthentication(request);
    if (authError) {
      return authError;
    }

    const { slug } = await context.params;
    const registry = await getComponentRegistry();

    await registry.deleteComponent(slug);

    return new Response(null, { status: 204 });
  } catch (error) {
    return handleError(error, "Delete component");
  }
}
