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
 * Wire shape — Task 21 migration: handler wraps `withErrorHandler` and
 * returns the canonical `{ data: <result> }` envelope per spec §10.2.
 * Validation errors flow through `nextlyValidationFromZod` (F11).
 *
 * @module api/email-providers-test
 */

import { z } from "zod";

import { container } from "../di";
import { NextlyError } from "../errors/nextly-error";
import { getNextly } from "../init";
import type { EmailProviderService } from "../services/email/email-provider-service";

import { createSuccessResponse } from "./create-success-response";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getEmailProviderService(): Promise<EmailProviderService> {
  await getNextly();
  return container.get<EmailProviderService>("emailProviderService");
}

function requireAuthHeader(request: Request): void {
  if (!request.headers.get("Authorization")) {
    throw NextlyError.authRequired();
  }
}

const testProviderSchema = z.object({
  // Optional — when omitted the service falls back to the provider's fromEmail.
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
 * Request Body (optional):
 * - email: Email address to send the test email to (optional — falls back
 *   to the provider's `fromEmail`)
 *
 * Response Codes:
 * - 200 OK: Test completed (check `success` field for result)
 * - 400 Bad Request: Invalid input
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Provider with ID does not exist
 * - 500 Internal Server Error: Test failed
 *
 * Response: `{ "data": { "success": boolean, "error"?: string } }`
 */
export const POST = withErrorHandler(
  async (request: Request, context: RouteContext): Promise<Response> => {
    requireAuthHeader(request);

    const { id } = await context.params;
    const service = await getEmailProviderService();

    // Body is optional: the legacy handler treated a missing JSON body as `{}`
    // so callers could omit the request body entirely. Preserve that.
    let body: unknown = {};
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        body = await request.json();
      } catch {
        throw new NextlyError({
          code: "VALIDATION_ERROR",
          publicMessage: "Validation failed.",
          publicData: {
            errors: [
              {
                path: "",
                code: "invalid_json",
                message: "Request body is not valid JSON.",
              },
            ],
          },
          logContext: { reason: "invalid-json-body" },
        });
      }
    }

    let validated: z.infer<typeof testProviderSchema>;
    try {
      validated = testProviderSchema.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    // `email` is optional; the service falls back to provider.fromEmail.
    const result = await service.testProvider(id, validated.email);

    return createSuccessResponse(result);
  }
);
