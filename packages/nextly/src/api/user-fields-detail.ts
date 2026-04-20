/**
 * User Field Definitions Detail API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * individual user field definition management endpoints at /api/user-fields/[id].
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/user-fields/[id]/route.ts
 * export { GET, PATCH, DELETE } from '@revnixhq/nextly/api/user-fields-detail';
 * ```
 *
 * @module api/user-fields-detail
 */

import { container } from "../di";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import type { UserFieldDefinitionService } from "../services/users/user-field-definition-service";

// ============================================================
// Types
// ============================================================

/**
 * Context object for dynamic route handlers.
 * Next.js 15+ requires params to be a Promise.
 */
interface RouteContext {
  params: Promise<{ id: string }>;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get the UserFieldDefinitionService from the DI container.
 * Uses getNextly() to ensure services are initialized with config.
 */
async function getUserFieldDefinitionService(): Promise<UserFieldDefinitionService> {
  await getNextly();
  return container.get<UserFieldDefinitionService>(
    "userFieldDefinitionService"
  );
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
  console.error(`[User Fields Detail API] ${operation} error:`, error);

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
  return null;
}

// ============================================================
// Route Handlers
// ============================================================

/**
 * GET handler for retrieving a single user field definition by ID.
 *
 * Requires authentication. Returns the field definition including its
 * source (code or ui).
 *
 * Response Codes:
 * - 200 OK: Field definition retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Field definition with ID does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch field definition
 *
 * @param request - Next.js Request object
 * @param context - Route context with params Promise containing id
 * @returns Response with JSON field definition data
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer <token>" \
 *   "http://localhost:3000/api/user-fields/abc-123"
 * # => {"data":{"id":"abc-123","name":"company","type":"text",...}}
 * ```
 */
export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const authError = checkAuthentication(request);
    if (authError) return authError;

    const { id } = await context.params;
    const service = await getUserFieldDefinitionService();
    const field = await service.getField(id);

    return successResponse(field);
  } catch (error) {
    return handleError(error, "Get user field definition");
  }
}

/**
 * PATCH handler for updating a user field definition.
 *
 * Requires authentication. Only UI-sourced fields can be updated.
 * Code-sourced fields (from `defineConfig()`) return 422 Business Rule Violation.
 * The `source` property cannot be changed after creation.
 *
 * Request Body (all fields optional):
 * - name: Field name (database column name)
 * - label: Display label
 * - type: Field type
 * - required: Whether the field is required
 * - defaultValue: Default value
 * - options: Array of {label, value} for select/radio
 * - placeholder: Input placeholder text
 * - description: Help text
 * - sortOrder: Display order
 * - isActive: Enable/disable field
 *
 * Response Codes:
 * - 200 OK: Field definition updated successfully
 * - 400 Bad Request: Invalid JSON body
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Field definition with ID does not exist
 * - 422 Unprocessable Entity: Cannot modify code-sourced field
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Update failed
 *
 * @param request - Next.js Request object with JSON body
 * @param context - Route context with params Promise containing id
 * @returns Response with JSON updated field definition
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/user-fields/abc-123', {
 *   method: 'PATCH',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({
 *     label: 'Updated Label',
 *     required: true,
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
    if (authError) return authError;

    const { id } = await context.params;
    const service = await getUserFieldDefinitionService();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.label !== undefined) updateData.label = body.label;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.required !== undefined) updateData.required = body.required;
    if (body.defaultValue !== undefined)
      updateData.defaultValue = body.defaultValue;
    if (body.options !== undefined) updateData.options = body.options;
    if (body.placeholder !== undefined)
      updateData.placeholder = body.placeholder;
    if (body.description !== undefined)
      updateData.description = body.description;
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const field = await service.updateField(id, updateData);

    return successResponse(field);
  } catch (error) {
    return handleError(error, "Update user field definition");
  }
}

/**
 * DELETE handler for removing a user field definition.
 *
 * Requires authentication. Only UI-sourced fields can be deleted.
 * Code-sourced fields (from `defineConfig()`) return 422 Business Rule Violation.
 * To remove a code-sourced field, remove it from `defineConfig()`.
 *
 * Response Codes:
 * - 200 OK: Field definition deleted successfully
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Field definition with ID does not exist
 * - 422 Unprocessable Entity: Cannot delete code-sourced field
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Deletion failed
 *
 * @param request - Next.js Request object
 * @param context - Route context with params Promise containing id
 * @returns Response with success confirmation
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/user-fields/abc-123', {
 *   method: 'DELETE',
 *   headers: { 'Authorization': 'Bearer <token>' },
 * });
 * const { data } = await response.json();
 * // => { success: true }
 * ```
 */
export async function DELETE(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const authError = checkAuthentication(request);
    if (authError) return authError;

    const { id } = await context.params;
    const service = await getUserFieldDefinitionService();

    await service.deleteField(id);

    return successResponse({ success: true });
  } catch (error) {
    return handleError(error, "Delete user field definition");
  }
}
