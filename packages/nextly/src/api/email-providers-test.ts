/**
 * Email Provider Test API Route Handler for Next.js
 *
 * Sends a test email through a specific provider to verify configuration.
 * Re-export in your Next.js application at /api/email-providers/[id]/test.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-providers/[id]/test/route.ts
 * export { POST } from 'nextly/api/email-providers-test';
 * ```
 *
 * @module api/email-providers-test
 */

import { z } from "zod";

import { actorFromAuthContext } from "../auth/request-actor";
import { container } from "../di";
import { SYSTEM_WRITE_POLICY } from "../domains/auth/system-write-policy";
import { testSendRecipientOf } from "../domains/email/test-send-recipient";
import type { UserService } from "../domains/users/services/user-service";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import type { EmailProviderService } from "../services/email/email-provider-service";

import { respondAction } from "./response-shapes";
import { requireRouteAnyPermission } from "./route-auth";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getEmailProviderService(): Promise<EmailProviderService> {
  await getCachedNextly();
  return container.get<EmailProviderService>("emailProviderService");
}

const testProviderSchema = z.object({
  // Accepted for compatibility and ignored: a test's destination is the
  // signed-in person's own address, decided below, never one the caller
  // writes. The field stays in the schema so a caller from before this was
  // true parses as before.
  email: z.string().email("A valid test email address is required").optional(),
});

/**
 * POST handler for testing an email provider.
 *
 * Sends a test email through the specified provider to verify that
 * the configuration (credentials, host, etc.) is correct.
 *
 * Requires authentication, as a signed-in person: the test goes to that
 * person's own address, and an API key, which names no one, is refused.
 * A provider may be tested while it is off — the guided flow saves a new
 * provider off, tests it, and only then offers to turn it on — so an
 * integration never has to enable untested credentials to check them.
 *
 * Request Body (optional, ignored):
 * - email: accepted for compatibility and ignored; the destination is always
 *   the signed-in person's own address, as the dispatcher's catch-all route
 *   decides it
 *
 * Response Codes:
 * - 200 OK: Test completed (check `success` field for result)
 * - 400 Bad Request: Invalid input
 * - 401 Unauthorized: Authentication required
 * - 403 Forbidden: Caller is not a signed-in person with an address
 * - 404 Not Found: Provider with ID does not exist
 * - 500 Internal Server Error: Test failed
 *
 * Response: `{ "data": { "success": boolean, "error"?: string } }`
 */
export const POST = withErrorHandler(
  async (request: Request, context: RouteContext): Promise<Response> => {
    const auth = await requireRouteAnyPermission(request, [
      ...SYSTEM_WRITE_POLICY.emailProviders.sendTest.anyOf,
    ]);

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

    // Parsed for the validation a legacy caller still gets, not for a value:
    // nothing in the body reaches the send.
    try {
      testProviderSchema.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    // A test send has exactly one destination, and it is not the caller's to
    // choose: the signed-in person's own address, resolved exactly as the
    // dispatcher's catch-all route resolves it. A body `email` is ignored
    // above, and an API key, which names no person and no address, is
    // refused here.
    const to = await testSendRecipientOf(
      actorFromAuthContext(auth),
      container.get<UserService>("userService")
    );
    const result = await service.testProvider(id, to);

    // testProvider always returns 200 at the request layer (per-attempt
    // delivery success rides in `result.success`). Match the dispatcher
    // wire shape so REST + dispatcher surfaces stay aligned.
    return respondAction("Test email dispatched.", { result });
  }
);
