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
 * The list endpoint is not server-paginated; admin code reads the array
 * length directly. There is no synthetic `meta.total`.
 *
 * @module api/email-providers
 */

import { z } from "zod";

import { container } from "../di";
import { getCachedNextly } from "../init";
import type { EmailProviderService } from "../services/email/email-provider-service";

import { requireAuthHeader } from "./auth-header-only";
import { readJsonBody } from "./read-json-body";
import { respondData, respondMutation } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

async function getEmailProviderService(): Promise<EmailProviderService> {
  await getCachedNextly();
  return container.get<EmailProviderService>("emailProviderService");
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
 * - 500 Internal Server Error: Failed to fetch providers
 *
 * Response: `{ "data": EmailProvider[] }`; non-paginated list.
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer <token>" \
 *   "http://localhost:3000/api/email-providers"
 * # => {"data":[...]}
 * ```
 */
export const GET = withErrorHandler(
  async (request: Request): Promise<Response> => {
    requireAuthHeader(request);

    const service = await getEmailProviderService();
    const providers = await service.listProviders();

    // Non-paginated list; wrap in a named field for the canonical
    // respondData shape (spec §5.1 rule 3).
    return respondData({ providers });
  }
);

/**
 * POST handler for creating a new email provider.
 *
 * Requires authentication. Creates a provider with encrypted configuration.
 * If `isDefault` is true, the previous default provider is unset atomically.
 *
 * Request Body:
 * - name: Display name (required)
 * - type: Provider type, one of "smtp", "resend", or "sendlayer" (required)
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
 * - 500 Internal Server Error: Creation failed
 *
 * Response: `{ "data": EmailProvider }`; created provider with masked
 * configuration. Status 201.
 */
export const POST = withErrorHandler(
  async (request: Request): Promise<Response> => {
    requireAuthHeader(request);

    const body = await readJsonBody(request);

    let validated: z.infer<typeof createProviderSchema>;
    try {
      validated = createProviderSchema.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const service = await getEmailProviderService();
    const provider = await service.createProvider(validated);

    return respondMutation("Email provider created.", provider, { status: 201 });
  }
);
