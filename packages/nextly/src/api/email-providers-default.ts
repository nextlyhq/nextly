/**
 * Email Provider Default API Route Handler for Next.js
 *
 * Sets a specific email provider as the default. The previous default
 * provider is unset atomically in a transaction.
 * Re-export in your Next.js application at /api/email-providers/[id]/default.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-providers/[id]/default/route.ts
 * export { PATCH } from '@revnixhq/nextly/api/email-providers-default';
 * ```
 *
 * @module api/email-providers-default
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
  console.error(`[Email Providers Default API] ${operation} error:`, error);

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
 * PATCH handler for setting an email provider as the default.
 *
 * Requires authentication. Unsets the previous default provider and sets
 * the specified provider as default in a single transaction.
 *
 * No request body required — the provider ID is in the URL path.
 *
 * Response Codes:
 * - 200 OK: Provider set as default successfully
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Provider with ID does not exist
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Operation failed
 *
 * @param request - Next.js Request object
 * @param context - Route context with params Promise containing id
 * @returns Response with JSON updated provider (masked configuration)
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/email-providers/abc-123/default', {
 *   method: 'PATCH',
 *   headers: { 'Authorization': 'Bearer <token>' },
 * });
 * const { data: provider } = await response.json();
 * // provider.isDefault === true
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

    const provider = await service.setDefault(id);

    return Response.json(
      { data: provider },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return handleError(error, "Set default email provider");
  }
}
