/**
 * Email Template Preview API Route Handler for Next.js
 *
 * Renders a template with sample data to preview the interpolated output.
 * Re-export in your Next.js application at /api/email-templates/[id]/preview.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-templates/[id]/preview/route.ts
 * export { POST } from '@revnixhq/nextly/api/email-templates-preview';
 * ```
 *
 * Wire shape — Task 21 migration: handler wraps `withErrorHandler` and
 * returns the canonical `{ data: <result> }` envelope per spec §10.2.
 * The rendered subject/html stay JSON-encoded inside `data` (no raw HTML
 * response — admin renders the preview in an iframe sandbox).
 *
 * @module api/email-templates-preview
 */

import { z } from "zod";

import { container } from "../di";
import { getCachedNextly } from "../init";
import type { EmailTemplateService } from "../services/email/email-template-service";

import { requireAuthHeader } from "./auth-header-only";
import { createSuccessResponse } from "./create-success-response";
import { readJsonBody } from "./read-json-body";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getEmailTemplateService(): Promise<EmailTemplateService> {
  await getCachedNextly();
  return container.get<EmailTemplateService>("emailTemplateService");
}

const previewSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

/**
 * POST handler for previewing an email template with sample data.
 *
 * Renders the template by replacing `{{variable}}` placeholders with values
 * from the provided `data` object. Supports dot-notation for nested values
 * (e.g., `{{user.name}}`). HTML-escapes interpolated values by default.
 * Wraps with shared layout (header/footer) when the template has
 * `useLayout: true`.
 *
 * Requires authentication.
 *
 * Request Body:
 * - data: Object with key-value pairs for variable interpolation (required)
 *
 * Response Codes:
 * - 200 OK: Preview rendered successfully
 * - 400 Bad Request: Invalid input
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Template with ID does not exist
 * - 500 Internal Server Error: Preview failed
 *
 * Response: `{ "data": { "subject": string, "html": string } }`
 */
export const POST = withErrorHandler(
  async (request: Request, context: RouteContext): Promise<Response> => {
    requireAuthHeader(request);

    const { id } = await context.params;
    const service = await getEmailTemplateService();

    const body = await readJsonBody(request);

    let validated: z.infer<typeof previewSchema>;
    try {
      validated = previewSchema.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const preview = await service.previewTemplate(id, validated.data);

    return createSuccessResponse(preview);
  }
);
