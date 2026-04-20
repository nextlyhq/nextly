/**
 * Email Provider Test API Route Handler for Next.js
 *
 * Sends a test email through a specific provider to verify configuration.
 * Re-export in your Next.js application at /api/email-providers/[id]/test.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-providers/[id]/test/route.ts
 * export { POST } from '@revnixhq/nextly/api/email-providers-test';
 * ```
 *
 * @module api/email-providers-test
 */

import { z } from "zod";

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
  console.error(`[Email Providers Test API] ${operation} error:`, error);

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

const testProviderSchema = z.object({
  // Optional — when omitted the service falls back to the provider's fromEmail
  email: z.string().email("A valid test email address is required").optional(),
});

/**
 * POST handler for testing an email provider.
 *
 * Sends a test email through the specified provider to verify that
 * the configuration (credentials, host, etc.) is correct.
 *
 * Requires authentication. Provider must be active.
 *
 * Request Body:
 * - email: Email address to send the test email to (required)
 *
 * Response Codes:
 * - 200 OK: Test completed (check `success` field for result)
 * - 400 Bad Request: Invalid input
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Provider with ID does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Test failed
 *
 * @param request - Next.js Request object with JSON body
 * @param context - Route context with params Promise containing id
 * @returns Response with test result `{ success: boolean, error?: string }`
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/email-providers/abc-123/test', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({ email: 'test@example.com' }),
 * });
 * const result = await response.json();
 * // => { data: { success: true } }
 * // or { data: { success: false, error: "Connection refused" } }
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
    const service = await getEmailProviderService();

    // Body is optional — an empty body (no JSON) is perfectly valid
    let body: unknown = {};
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        body = await request.json();
      } catch {
        return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
      }
    }

    const validated = testProviderSchema.parse(body);

    // `testEmail` is optional; the service falls back to provider.fromEmail
    const result = await service.testProvider(id, validated.email);

    return Response.json(
      { data: result },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return handleError(error, "Test email provider");
  }
}
