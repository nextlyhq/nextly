/**
 * Email Providers API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * email provider management endpoints at /api/email-providers.
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-providers/route.ts
 * export { GET, POST } from '@revnixhq/nextly/api/email-providers';
 * ```
 *
 * @module api/email-providers
 */

import { z } from "zod";

import { container } from "../di";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import type { EmailProviderService } from "../services/email/email-provider-service";

async function getEmailProviderService(): Promise<EmailProviderService> {
  await getNextly();
  return container.get<EmailProviderService>("emailProviderService");
}

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
  console.error(`[Email Providers API] ${operation} error:`, error);

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

const createProviderSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  type: z.enum(["smtp", "resend", "sendlayer"], {
    message: "Type must be 'smtp', 'resend', or 'sendlayer'",
  }),
  fromEmail: z.string().email("Invalid from email address"),
  fromName: z.string().max(255).optional().nullable(),
  configuration: z.record(z.string(), z.unknown()),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

/**
 * GET handler for listing all email providers.
 *
 * Requires authentication. Returns providers with masked configuration
 * (sensitive fields like API keys and passwords are replaced with "••••••••").
 *
 * Response Codes:
 * - 200 OK: Providers list retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Failed to fetch providers
 *
 * @param request - Next.js Request object
 * @returns Response with JSON provider list
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer <token>" \
 *   "http://localhost:3000/api/email-providers"
 * # => {"data":[...],"meta":{"total":2}}
 * ```
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const authError = checkAuthentication(request);
    if (authError) return authError;

    const service = await getEmailProviderService();
    const providers = await service.listProviders();

    return successResponse(providers, 200, {
      total: providers.length,
    });
  } catch (error) {
    return handleError(error, "List email providers");
  }
}

/**
 * POST handler for creating a new email provider.
 *
 * Requires authentication. Creates a provider with encrypted configuration.
 * If `isDefault` is true, the previous default provider is unset atomically.
 *
 * Request Body:
 * - name: Display name (required)
 * - type: Provider type - "smtp", "resend", or "sendlayer" (required)
 * - fromEmail: From email address (required)
 * - fromName: From display name (optional)
 * - configuration: Provider-specific config object (required)
 * - isDefault: Set as default provider (optional, default: false)
 * - isActive: Enable provider (optional, default: true)
 *
 * Response Codes:
 * - 201 Created: Provider created successfully
 * - 400 Bad Request: Invalid input
 * - 401 Unauthorized: Authentication required
 * - 503 Service Unavailable: Services not initialized
 * - 500 Internal Server Error: Creation failed
 *
 * @param request - Next.js Request object with JSON body
 * @returns Response with JSON created provider (masked configuration)
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/email-providers', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer <token>',
 *   },
 *   body: JSON.stringify({
 *     name: 'SendLayer Production',
 *     type: 'sendlayer',
 *     fromEmail: 'noreply@example.com',
 *     fromName: 'My App',
 *     configuration: { apiKey: 'sl-...' },
 *     isDefault: true,
 *   }),
 * });
 * const { data: provider } = await response.json();
 * ```
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const authError = checkAuthentication(request);
    if (authError) return authError;

    const service = await getEmailProviderService();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
    }

    const validated = createProviderSchema.parse(body);

    const provider = await service.createProvider(validated);

    return successResponse(provider, 201);
  } catch (error) {
    return handleError(error, "Create email provider");
  }
}
