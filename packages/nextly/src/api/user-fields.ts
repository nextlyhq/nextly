/**
 * User Field Definitions API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * user field definition management endpoints at /api/user-fields.
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/user-fields/route.ts
 * export { GET, POST } from '@revnixhq/nextly/api/user-fields';
 * ```
 *
 * @module api/user-fields
 */

import { z } from "zod";

import { container } from "../di";
import type { NextlyServiceConfig } from "../di/register";
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
  console.error(`[User Fields API] ${operation} error:`, error);

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
 * Option schema for select/radio field types
 */
const optionSchema = z.object({
  label: z.string().min(1, "Option label is required"),
  value: z.string().min(1, "Option value is required"),
});

/**
 * Schema for creating a new user field definition
 */
const createFieldSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(255)
    .regex(
      /^[a-zA-Z][a-zA-Z0-9]*$/,
      "Name must start with a letter and contain only alphanumeric characters"
    ),
  label: z.string().min(1, "Label is required").max(255),
  type: z.enum(
    [
      "text",
      "textarea",
      "number",
      "email",
      "select",
      "radio",
      "checkbox",
      "date",
    ],
    {
      message:
        "Type must be one of: text, textarea, number, email, select, radio, checkbox, date",
    }
  ),
  required: z.boolean().optional(),
  defaultValue: z.string().optional().nullable(),
  options: z.array(optionSchema).optional().nullable(),
  placeholder: z.string().max(255).optional().nullable(),
  description: z.string().optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

// ============================================================
// Route Handlers
// ============================================================

/**
 * GET handler for listing all user field definitions.
 *
 * Requires authentication. Returns all field definitions (both code-sourced
 * and UI-sourced), ordered by sort order ascending.
 *
 * Response Codes:
 * - 200 OK: Field definitions list retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch field definitions
 *
 * @param request - Next.js Request object
 * @returns Response with JSON field definitions list
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer <token>" \
 *   "http://localhost:3000/api/user-fields"
 * # => {"data":[...],"meta":{"total":5}}
 * ```
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const authError = checkAuthentication(request);
    if (authError) return authError;

    const service = await getUserFieldDefinitionService();
    const fields = await service.listFields();

    // Read user admin config (listFields, group) from defineConfig()
    const config = container.get<NextlyServiceConfig>("config");
    const adminConfig = config?.users?.admin ?? undefined;

    return successResponse(fields, 200, {
      total: fields.length,
      ...(adminConfig && { adminConfig }),
    });
  } catch (error) {
    return handleError(error, "List user field definitions");
  }
}

/**
 * POST handler for creating a new user field definition.
 *
 * Requires authentication. Only UI-sourced fields can be created via API.
 * The `source` is automatically set to `'ui'`. Code-sourced fields are
 * managed via `defineConfig()` and synced on startup.
 *
 * Request Body:
 * - name: Field name (alphanumeric, starts with letter) (required)
 * - label: Display label (required)
 * - type: Field type - text, textarea, number, email, select, radio, checkbox, date (required)
 * - required: Whether the field is required (optional, default: false)
 * - defaultValue: Default value (optional)
 * - options: Array of {label, value} for select/radio types (optional)
 * - placeholder: Input placeholder text (optional)
 * - description: Help text shown below field (optional)
 * - sortOrder: Display order, lower first (optional, auto-assigned)
 * - isActive: Enable field (optional, default: true)
 *
 * Response Codes:
 * - 201 Created: Field definition created successfully
 * - 400 Bad Request: Invalid input
 * - 401 Unauthorized: Authentication required
 * - 409 Conflict: Field name already exists
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Creation failed
 *
 * @param request - Next.js Request object with JSON body
 * @returns Response with JSON created field definition
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/user-fields', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({
 *     name: 'company',
 *     label: 'Company',
 *     type: 'text',
 *     placeholder: 'Enter company name',
 *   }),
 * });
 * const { data: field } = await response.json();
 * ```
 */
export async function POST(request: Request): Promise<Response> {
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

    const validated = createFieldSchema.parse(body);

    // Force source to 'ui' — code-sourced fields are managed via defineConfig()
    const field = await service.createField({
      ...validated,
      source: "ui",
    });

    return successResponse(field, 201);
  } catch (error) {
    return handleError(error, "Create user field definition");
  }
}
