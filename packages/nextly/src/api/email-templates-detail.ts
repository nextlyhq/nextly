/**
 * Email Templates Detail API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * individual email template management endpoints at /api/email-templates/[id].
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-templates/[id]/route.ts
 * export { GET, PATCH, DELETE } from '@revnixhq/nextly/api/email-templates-detail';
 * ```
 *
 * @module api/email-templates-detail
 */

import { container } from "../di";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import type { EmailTemplateService } from "../services/email/email-template-service";

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
 * Get the EmailTemplateService from the DI container.
 * Uses getNextly() to ensure services are initialized with config.
 */
async function getEmailTemplateService(): Promise<EmailTemplateService> {
  await getNextly();
  return container.get<EmailTemplateService>("emailTemplateService");
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
  console.error(`[Email Templates Detail API] ${operation} error:`, error);

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
 * GET handler for retrieving a single email template by ID.
 *
 * Requires authentication.
 *
 * Response Codes:
 * - 200 OK: Template retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Template with ID does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch template
 *
 * @param request - Next.js Request object
 * @param context - Route context with params Promise containing id
 * @returns Response with JSON template data
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer <token>" \
 *   "http://localhost:3000/api/email-templates/abc-123"
 * # => {"data":{"id":"abc-123","name":"Welcome Email","slug":"welcome",...}}
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
    const service = await getEmailTemplateService();
    const template = await service.getTemplate(id);

    return successResponse(template);
  } catch (error) {
    return handleError(error, "Get email template");
  }
}

/**
 * PATCH handler for updating an email template.
 *
 * Requires authentication. Template `slug` cannot be changed after creation.
 *
 * Request Body (all fields optional):
 * - name: Template display name
 * - subject: Email subject line
 * - htmlContent: HTML body
 * - plainTextContent: Plain text fallback
 * - variables: Array of variable metadata objects
 * - useLayout: Wrap with shared header/footer
 * - isActive: Enable/disable template
 * - providerId: Use specific provider for this template (null to use default)
 *
 * Response Codes:
 * - 200 OK: Template updated successfully
 * - 400 Bad Request: Invalid JSON body
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Template with ID does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Update failed
 *
 * @param request - Next.js Request object with JSON body
 * @param context - Route context with params Promise containing id
 * @returns Response with JSON updated template
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/email-templates/abc-123', {
 *   method: 'PATCH',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({
 *     subject: 'Updated Subject: {{userName}}',
 *     htmlContent: '<h1>Updated content</h1>',
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
    const service = await getEmailTemplateService();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.subject !== undefined) updateData.subject = body.subject;
    if (body.htmlContent !== undefined)
      updateData.htmlContent = body.htmlContent;
    if (body.plainTextContent !== undefined)
      updateData.plainTextContent = body.plainTextContent;
    if (body.variables !== undefined) updateData.variables = body.variables;
    if (body.useLayout !== undefined) updateData.useLayout = body.useLayout;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.providerId !== undefined) updateData.providerId = body.providerId;

    const template = await service.updateTemplate(id, updateData);

    return successResponse(template);
  } catch (error) {
    return handleError(error, "Update email template");
  }
}

/**
 * DELETE handler for removing an email template.
 *
 * Requires authentication. Cannot delete layout templates (`_email-header`,
 * `_email-footer`) — use the layout endpoint to modify them.
 *
 * Response Codes:
 * - 200 OK: Template deleted successfully
 * - 401 Unauthorized: Authentication required
 * - 403 Forbidden: Cannot delete layout templates
 * - 404 Not Found: Template with ID does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Deletion failed
 *
 * @param request - Next.js Request object
 * @param context - Route context with params Promise containing id
 * @returns Response with success confirmation
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/email-templates/abc-123', {
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
    const service = await getEmailTemplateService();

    await service.deleteTemplate(id);

    return successResponse({ success: true });
  } catch (error) {
    return handleError(error, "Delete email template");
  }
}
