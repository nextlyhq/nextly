/**
 * Email Providers Detail API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * individual email provider management endpoints at /api/email-providers/[id].
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-providers/[id]/route.ts
 * export { GET, PATCH, DELETE } from '@revnixhq/nextly/api/email-providers-detail';
 * ```
 *
 * Wire shape — Task 21 migration: handlers wrap `withErrorHandler` and return
 * the canonical `{ data: <result> }` envelope per spec §10.2. The
 * mechanical migration preserves the legacy header-only auth check; real
 * verification lives downstream.
 *
 * @module api/email-providers-detail
 */

import { container } from "../di";
import { NextlyError } from "../errors/nextly-error";
import { getNextly } from "../init";
import type { EmailProviderService } from "../services/email/email-provider-service";

import { requireAuthHeader } from "./auth-header-only";
import { createSuccessResponse } from "./create-success-response";
import { withErrorHandler } from "./with-error-handler";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getEmailProviderService(): Promise<EmailProviderService> {
  await getNextly();
  return container.get<EmailProviderService>("emailProviderService");
}

async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
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

/**
 * GET handler for retrieving a single email provider by ID.
 *
 * Requires authentication. Returns provider with masked configuration.
 *
 * Response Codes:
 * - 200 OK: Provider retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Provider with ID does not exist
 * - 500 Internal Server Error: Failed to fetch provider
 *
 * Response: `{ "data": EmailProvider }`
 */
export const GET = withErrorHandler(
  async (request: Request, context: RouteContext): Promise<Response> => {
    requireAuthHeader(request);

    const { id } = await context.params;
    const service = await getEmailProviderService();
    const provider = await service.getProvider(id);

    return createSuccessResponse(provider);
  }
);

/**
 * PATCH handler for updating an email provider.
 *
 * Requires authentication. Provider `type` cannot be changed after creation.
 * Configuration is re-encrypted before storage.
 *
 * Request Body (all fields optional):
 * - name: Display name
 * - fromEmail: From email address
 * - fromName: From display name
 * - configuration: Provider-specific config object
 * - isActive: Enable/disable provider
 *
 * Response Codes:
 * - 200 OK: Provider updated successfully
 * - 400 Bad Request: Invalid JSON body
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Provider with ID does not exist
 * - 500 Internal Server Error: Update failed
 *
 * Response: `{ "data": EmailProvider }` — updated provider with masked
 * configuration.
 */
export const PATCH = withErrorHandler(
  async (request: Request, context: RouteContext): Promise<Response> => {
    requireAuthHeader(request);

    const { id } = await context.params;
    const body = (await readJsonBody(request)) as Record<string, unknown>;

    // Selective copy: only forward fields the legacy handler accepted, so
    // unknown keys are silently ignored (matches the pre-migration contract).
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.fromEmail !== undefined) updateData.fromEmail = body.fromEmail;
    if (body.fromName !== undefined) updateData.fromName = body.fromName;
    if (body.configuration !== undefined)
      updateData.configuration = body.configuration;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const service = await getEmailProviderService();
    const provider = await service.updateProvider(id, updateData);

    return createSuccessResponse(provider);
  }
);

/**
 * DELETE handler for removing an email provider.
 *
 * Requires authentication. Cannot delete the default provider — set another
 * provider as default first.
 *
 * Response Codes:
 * - 200 OK: Provider deleted successfully
 * - 401 Unauthorized: Authentication required
 * - 403 Forbidden: Cannot delete the default provider
 * - 404 Not Found: Provider with ID does not exist
 * - 500 Internal Server Error: Deletion failed
 *
 * Response: `{ "data": { "success": true } }`
 */
export const DELETE = withErrorHandler(
  async (request: Request, context: RouteContext): Promise<Response> => {
    requireAuthHeader(request);

    const { id } = await context.params;
    const service = await getEmailProviderService();

    await service.deleteProvider(id);

    return createSuccessResponse({ success: true });
  }
);
