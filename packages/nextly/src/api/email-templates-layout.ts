/**
 * Email Template Layout API Route Handlers for Next.js
 *
 * Manages the shared email header and footer HTML that wraps every
 * template's body content. Layout is stored as two reserved rows in the
 * `email_templates` table with slugs `_email-header` and `_email-footer`.
 *
 * Re-export in your Next.js application at /api/email-templates/layout.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-templates/layout/route.ts
 * export { GET, PATCH } from '@revnixhq/nextly/api/email-templates-layout';
 * ```
 *
 * @module api/email-templates-layout
 */

import { container } from "../di";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import type { EmailTemplateService } from "../services/email/email-template-service";

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
  console.error(`[Email Templates Layout API] ${operation} error:`, error);

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

// ============================================================
// Route Handlers
// ============================================================

/**
 * GET handler for retrieving the shared email layout (header + footer).
 *
 * Requires authentication. Returns the `htmlContent` of the reserved
 * `_email-header` and `_email-footer` template rows. Returns empty
 * strings if layout templates haven't been created yet.
 *
 * Response Codes:
 * - 200 OK: Layout retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch layout
 *
 * @param request - Next.js Request object
 * @returns Response with JSON `{ header: string, footer: string }`
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer <token>" \
 *   "http://localhost:3000/api/email-templates/layout"
 * # => {"data":{"header":"<html>...","footer":"...</html>"}}
 * ```
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const authError = checkAuthentication(request);
    if (authError) return authError;

    const service = await getEmailTemplateService();
    const layout = await service.getLayout();

    return Response.json(
      { data: layout },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return handleError(error, "Get email layout");
  }
}

/**
 * PATCH handler for updating the shared email header and/or footer.
 *
 * Requires authentication. Creates layout templates if they don't exist
 * yet (upsert behavior). Both fields are optional — only provided fields
 * are updated.
 *
 * Request Body (all fields optional):
 * - header: HTML content for the shared email header
 * - footer: HTML content for the shared email footer
 *
 * Response Codes:
 * - 200 OK: Layout updated successfully
 * - 400 Bad Request: Invalid JSON body
 * - 401 Unauthorized: Authentication required
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Update failed
 *
 * @param request - Next.js Request object with JSON body
 * @returns Response with JSON updated layout `{ header, footer }`
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/email-templates/layout', {
 *   method: 'PATCH',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({
 *     header: '<div style="background:#333;color:#fff;padding:20px;">My App</div>',
 *     footer: '<div style="text-align:center;color:#999;">© {{year}} My App</div>',
 *   }),
 * });
 * const { data: layout } = await response.json();
 * ```
 */
export async function PATCH(request: Request): Promise<Response> {
  try {
    const authError = checkAuthentication(request);
    if (authError) return authError;

    const service = await getEmailTemplateService();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
    }

    const updateData: { header?: string; footer?: string } = {};
    if (typeof body.header === "string") updateData.header = body.header;
    if (typeof body.footer === "string") updateData.footer = body.footer;

    await service.updateLayout(updateData);

    // Return the full layout after update
    const layout = await service.getLayout();

    return Response.json(
      { data: layout },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return handleError(error, "Update email layout");
  }
}
