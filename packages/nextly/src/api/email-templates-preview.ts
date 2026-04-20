/**
 * Email Template Preview API Route Handler for Next.js
 *
 * Renders a template with sample data to preview the interpolated output.
 * Re-export in your Next.js application at /api/email-templates/[id]/preview.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-templates/[id]/preview/route.ts
 * export { POST } from '@revnixhq/nextly/api/email-templates-preview';
 * ```
 *
 * @module api/email-templates-preview
 */

import { z } from "zod";

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

async function getEmailTemplateService(): Promise<EmailTemplateService> {
  await getNextly();
  return container.get<EmailTemplateService>("emailTemplateService");
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
  console.error(`[Email Templates Preview API] ${operation} error:`, error);

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

function checkAuthentication(request: Request): Response | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse("Authentication required", 401, "UNAUTHORIZED");
  }
  return null;
}

// ============================================================
// Validation Schema
// ============================================================

const previewSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

// ============================================================
// Route Handler
// ============================================================

/**
 * POST handler for previewing an email template with sample data.
 *
 * Renders the template by replacing `{{variable}}` placeholders with values
 * from the provided `data` object. Supports dot-notation for nested values
 * (e.g., `{{user.name}}`). HTML-escapes interpolated values by default.
 * Wraps with shared layout (header/footer) when the template has
 * `useLayout: true`.
 *
 * Requires authentication.
 *
 * Request Body:
 * - data: Object with key-value pairs for variable interpolation (required)
 *
 * Response Codes:
 * - 200 OK: Preview rendered successfully
 * - 400 Bad Request: Invalid input
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Template with ID does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Preview failed
 *
 * @param request - Next.js Request object with JSON body
 * @param context - Route context with params Promise containing id
 * @returns Response with rendered `{ subject, html }`
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/email-templates/abc-123/preview', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({
 *     data: {
 *       userName: 'John Doe',
 *       resetLink: 'https://example.com/reset?token=xyz',
 *       year: '2026',
 *     },
 *   }),
 * });
 * const { data: preview } = await response.json();
 * // preview.subject => "Reset Your Password"
 * // preview.html => "<html>...John Doe...</html>"
 * ```
 */
export async function POST(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const authError = checkAuthentication(request);
    if (authError) return authError;

    const { id } = await context.params;
    const service = await getEmailTemplateService();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
    }

    const validated = previewSchema.parse(body);

    const preview = await service.previewTemplate(id, validated.data);

    return Response.json(
      { data: preview },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return handleError(error, "Preview email template");
  }
}
