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
 * Wire shape — Task 21 migration: handler wraps `withErrorHandler` and
 * returns the canonical `{ data: <result> }` envelope per spec §10.2.
 *
 * @module api/email-providers-default
 */

import { container } from "../di";
import { NextlyError } from "../errors/nextly-error";
import { getNextly } from "../init";
import type { EmailProviderService } from "../services/email/email-provider-service";

import { createSuccessResponse } from "./create-success-response";
import { withErrorHandler } from "./with-error-handler";

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
 * - 500 Internal Server Error: Operation failed
 *
 * Response: `{ "data": EmailProvider }` — updated provider with `isDefault:
 * true` and masked configuration.
 */
export const PATCH = withErrorHandler(
  async (request: Request, context: RouteContext): Promise<Response> => {
    requireAuthHeader(request);

    const { id } = await context.params;
    const service = await getEmailProviderService();

    const provider = await service.setDefault(id);

    return createSuccessResponse(provider);
  }
);
