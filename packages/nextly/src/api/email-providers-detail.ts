/**
 * Email Providers Detail API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * individual email provider management endpoints at /api/email-providers/[id].
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-providers/[id]/route.ts
 * export { GET, PATCH, DELETE } from '@revnixhq/nextly/api/email-providers-detail';
 * ```
 *
 * @module api/email-providers-detail
 */

import { container } from "../di";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import type { EmailProviderService } from "../services/email/email-provider-service";

/**
 * Context object for dynamic route handlers.
 * Next.js 15+ requires params to be a Promise.
 */
interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getEmailProviderService(): Promise<EmailProviderService> {
  await getNextly();
  return container.get<EmailProviderService>("emailProviderService");
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
  console.error(`[Email Providers Detail API] ${operation} error:`, error);

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

function checkAuthentication(request: Request): Response | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse("Authentication required", 401, "UNAUTHORIZED");
  }
  return null;
}

/**
 * GET handler for retrieving a single email provider by ID.
 *
 * Requires authentication. Returns provider with masked configuration.
 *
 * Response Codes:
 * - 200 OK: Provider retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Provider with ID does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch provider
 *
 * @param request - Next.js Request object
 * @param context - Route context with params Promise containing id
 * @returns Response with JSON provider data
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer <token>" \
 *   "http://localhost:3000/api/email-providers/abc-123"
 * # => {"data":{"id":"abc-123","name":"SendLayer","type":"sendlayer",...}}
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
    const service = await getEmailProviderService();
    const provider = await service.getProvider(id);

    return successResponse(provider);
  } catch (error) {
    return handleError(error, "Get email provider");
  }
}

/**
 * PATCH handler for updating an email provider.
 *
 * Requires authentication. Provider `type` cannot be changed after creation.
 * Configuration is re-encrypted before storage.
 *
 * Request Body (all fields optional):
 * - name: Display name
 * - fromEmail: From email address
 * - fromName: From display name
 * - configuration: Provider-specific config object
 * - isActive: Enable/disable provider
 *
 * Response Codes:
 * - 200 OK: Provider updated successfully
 * - 400 Bad Request: Invalid JSON body
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Provider with ID does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Update failed
 *
 * @param request - Next.js Request object with JSON body
 * @param context - Route context with params Promise containing id
 * @returns Response with JSON updated provider (masked configuration)
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/email-providers/abc-123', {
 *   method: 'PATCH',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({
 *     name: 'Updated Provider Name',
 *     isActive: false,
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
    const service = await getEmailProviderService();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.fromEmail !== undefined) updateData.fromEmail = body.fromEmail;
    if (body.fromName !== undefined) updateData.fromName = body.fromName;
    if (body.configuration !== undefined)
      updateData.configuration = body.configuration;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const provider = await service.updateProvider(id, updateData);

    return successResponse(provider);
  } catch (error) {
    return handleError(error, "Update email provider");
  }
}

/**
 * DELETE handler for removing an email provider.
 *
 * Requires authentication. Cannot delete the default provider — set another
 * provider as default first.
 *
 * Response Codes:
 * - 200 OK: Provider deleted successfully
 * - 401 Unauthorized: Authentication required
 * - 403 Forbidden: Cannot delete the default provider
 * - 404 Not Found: Provider with ID does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Deletion failed
 *
 * @param request - Next.js Request object
 * @param context - Route context with params Promise containing id
 * @returns Response with success confirmation
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/email-providers/abc-123', {
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
    const service = await getEmailProviderService();

    await service.deleteProvider(id);

    return successResponse({ success: true });
  } catch (error) {
    return handleError(error, "Delete email provider");
  }
}
