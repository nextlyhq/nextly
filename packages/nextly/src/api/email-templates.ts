/**
 * Email Templates API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * email template management endpoints at /api/email-templates.
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-templates/route.ts
 * export { GET, POST } from '@revnixhq/nextly/api/email-templates';
 * ```
 *
 * @module api/email-templates
 */

import { z } from "zod";

import { container } from "../di";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import type { EmailTemplateService } from "../services/email/email-template-service";

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
  console.error(`[Email Templates API] ${operation} error:`, error);

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
 * Variable metadata schema for template variables
 */
const variableSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  required: z.boolean().optional(),
});

/**
 * Schema for creating a new email template
 */
const createTemplateSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(255)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must be lowercase alphanumeric with hyphens"
    ),
  subject: z.string().min(1, "Subject is required").max(500),
  htmlContent: z.string().min(1, "HTML content is required"),
  plainTextContent: z.string().optional().nullable(),
  variables: z.array(variableSchema).optional().nullable(),
  useLayout: z.boolean().optional(),
  isActive: z.boolean().optional(),
  providerId: z.string().uuid().optional().nullable(),
});

// ============================================================
// Route Handlers
// ============================================================

/**
 * GET handler for listing all email templates.
 *
 * Requires authentication. Returns all templates except layout templates
 * (`_email-header`, `_email-footer`). Use the layout endpoint to access those.
 *
 * Response Codes:
 * - 200 OK: Templates list retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch templates
 *
 * @param request - Next.js Request object
 * @returns Response with JSON template list
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer <token>" \
 *   "http://localhost:3000/api/email-templates"
 * # => {"data":[...],"meta":{"total":3}}
 * ```
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const authError = checkAuthentication(request);
    if (authError) return authError;

    const service = await getEmailTemplateService();
    const templates = await service.listTemplates();

    return successResponse(templates, 200, {
      total: templates.length,
    });
  } catch (error) {
    return handleError(error, "List email templates");
  }
}

/**
 * POST handler for creating a new email template.
 *
 * Requires authentication. Cannot use reserved slugs (`_email-header`,
 * `_email-footer`) — use the layout endpoint instead.
 *
 * Request Body:
 * - name: Template display name (required)
 * - slug: Unique identifier, lowercase with hyphens (required)
 * - subject: Email subject line with {{variable}} support (required)
 * - htmlContent: HTML body with {{variable}} support (required)
 * - plainTextContent: Plain text fallback (optional)
 * - variables: Array of variable metadata objects (optional)
 * - useLayout: Wrap with shared header/footer (optional, default: true)
 * - isActive: Enable template (optional, default: true)
 * - providerId: Use specific provider for this template (optional)
 *
 * Response Codes:
 * - 201 Created: Template created successfully
 * - 400 Bad Request: Invalid input or reserved slug
 * - 401 Unauthorized: Authentication required
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Creation failed
 *
 * @param request - Next.js Request object with JSON body
 * @returns Response with JSON created template
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/email-templates', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({
 *     name: 'Order Confirmation',
 *     slug: 'order-confirmation',
 *     subject: 'Your order #{{orderId}} has been confirmed',
 *     htmlContent: '<h1>Thank you, {{userName}}!</h1>...',
 *     variables: [
 *       { name: 'orderId', description: 'Order ID', required: true },
 *       { name: 'userName', description: "User's name" },
 *     ],
 *   }),
 * });
 * const { data: template } = await response.json();
 * ```
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const authError = checkAuthentication(request);
    if (authError) return authError;

    const service = await getEmailTemplateService();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
    }

    const validated = createTemplateSchema.parse(body);

    const template = await service.createTemplate(validated);

    return successResponse(template, 201);
  } catch (error) {
    return handleError(error, "Create email template");
  }
}
