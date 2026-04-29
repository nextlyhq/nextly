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
 * Wire shape — Task 21 migration: handlers wrap `withErrorHandler` and return
 * the canonical `{ data: <result> }` envelope per spec §10.2.
 *
 * @module api/user-fields-detail
 */

import { container } from "../di";
import { getNextly } from "../init";
import type { UserFieldDefinitionService } from "../services/users/user-field-definition-service";

import { requireAuthHeader } from "./auth-header-only";
import { createSuccessResponse } from "./create-success-response";
import { readJsonBody } from "./read-json-body";
import { withErrorHandler } from "./with-error-handler";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getUserFieldDefinitionService(): Promise<UserFieldDefinitionService> {
  await getNextly();
  return container.get<UserFieldDefinitionService>(
    "userFieldDefinitionService"
  );
}

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
 * - 500 Internal Server Error: Failed to fetch field definition
 *
 * Response: `{ "data": UserFieldDefinition }`
 */
export const GET = withErrorHandler(
  async (request: Request, context: RouteContext): Promise<Response> => {
    requireAuthHeader(request);

    const { id } = await context.params;
    const service = await getUserFieldDefinitionService();
    const field = await service.getField(id);

    return createSuccessResponse(field);
  }
);

/**
 * PATCH handler for updating a user field definition.
 *
 * Requires authentication. Only UI-sourced fields can be updated.
 * Code-sourced fields (from `defineConfig()`) return 422 Business Rule Violation.
 * The `source` property cannot be changed after creation.
 *
 * Request Body (all fields optional):
 * - name, label, type, required, defaultValue, options, placeholder,
 *   description, sortOrder, isActive.
 *
 * Response Codes:
 * - 200 OK: Field definition updated successfully
 * - 400 Bad Request: Invalid JSON body
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Field definition with ID does not exist
 * - 422 Unprocessable Entity: Cannot modify code-sourced field
 * - 500 Internal Server Error: Update failed
 *
 * Response: `{ "data": UserFieldDefinition }`
 */
export const PATCH = withErrorHandler(
  async (request: Request, context: RouteContext): Promise<Response> => {
    requireAuthHeader(request);

    const { id } = await context.params;
    const body = await readJsonBody(request);

    // Selective copy: only forward fields the legacy handler accepted, so
    // unknown keys are silently ignored (matches the pre-migration contract).
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

    const service = await getUserFieldDefinitionService();
    const field = await service.updateField(id, updateData);

    return createSuccessResponse(field);
  }
);

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
 * - 500 Internal Server Error: Deletion failed
 *
 * Response: `{ "data": { "success": true } }`
 */
export const DELETE = withErrorHandler(
  async (request: Request, context: RouteContext): Promise<Response> => {
    requireAuthHeader(request);

    const { id } = await context.params;
    const service = await getUserFieldDefinitionService();

    await service.deleteField(id);

    return createSuccessResponse({ success: true });
  }
);
