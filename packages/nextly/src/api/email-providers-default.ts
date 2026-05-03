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
import { getCachedNextly } from "../init";
import type { EmailProviderService } from "../services/email/email-provider-service";

import { requireAuthHeader } from "./auth-header-only";
import { respondAction } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getEmailProviderService(): Promise<EmailProviderService> {
  await getCachedNextly();
  return container.get<EmailProviderService>("emailProviderService");
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

    // Set-default is a non-CRUD mutation (no new resource, just a flag
    // flip). Match the dispatcher route's wire shape so REST + dispatcher
    // surfaces stay in lockstep.
    return respondAction("Default email provider updated.", { provider });
  }
);
