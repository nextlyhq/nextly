/**
 * User Field Definitions Reorder API Route Handler for Next.js
 *
 * Updates the sort order of user field definitions based on an array of
 * field IDs in the desired order. Re-export in your Next.js application
 * at /api/user-fields/reorder.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/user-fields/reorder/route.ts
 * export { PATCH } from '@revnixhq/nextly/api/user-fields-reorder';
 * ```
 *
 * @module api/user-fields-reorder
 */

import { z } from "zod";

import { container } from "../di";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import type { UserFieldDefinitionService } from "../services/users/user-field-definition-service";

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
  console.error(`[User Fields Reorder API] ${operation} error:`, error);

  if (isServiceError(error)) {
    return errorResponse(error.message, error.httpStatus, error.code);
  }

  if (error instanceof z.ZodError) {
    const firstError = error.issues[0];
    return errorResponse(
      firstError?.message || "Validation error",
      400,
      "VALIDATION_ERROR"
    );
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
// Validation Schemas
// ============================================================

/**
 * Schema for reorder request body
 */
const reorderSchema = z.object({
  fieldIds: z
    .array(z.string().min(1, "Field ID cannot be empty"))
    .min(1, "At least one field ID is required"),
});

// ============================================================
// Route Handler
// ============================================================

/**
 * PATCH handler for reordering user field definitions.
 *
 * Requires authentication. Accepts an array of field IDs in the desired
 * display order. Each field's `sortOrder` is updated to match its position
 * in the array (0-indexed). Field IDs not in the array keep their current
 * sort order. The operation is atomic (uses a transaction).
 *
 * Request Body:
 * - fieldIds: Array of field definition IDs in desired order (required)
 *
 * Response Codes:
 * - 200 OK: Fields reordered successfully
 * - 400 Bad Request: Invalid input
 * - 401 Unauthorized: Authentication required
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Reorder failed
 *
 * @param request - Next.js Request object with JSON body
 * @returns Response with JSON updated field definitions list
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/user-fields/reorder', {
 *   method: 'PATCH',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({
 *     fieldIds: ['uuid-3', 'uuid-1', 'uuid-2'],
 *   }),
 * });
 * const { data: fields } = await response.json();
 * // fields are now in the new order
 * ```
 */
export async function PATCH(request: Request): Promise<Response> {
  try {
    const authError = checkAuthentication(request);
    if (authError) return authError;

    const service = await getUserFieldDefinitionService();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
    }

    const validated = reorderSchema.parse(body);

    const fields = await service.reorderFields(validated.fieldIds);

    return Response.json(
      { data: fields },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return handleError(error, "Reorder user field definitions");
  }
}
