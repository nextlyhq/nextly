/**
 * Email Template Layout API Route Handlers for Next.js
 *
 * Manages the shared email header and footer HTML that wraps every
 * template's body content. Layout is stored as two reserved rows in the
 * `email_templates` table with slugs `_email-header` and `_email-footer`.
 *
 * Re-export in your Next.js application at /api/email-templates/layout.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-templates/layout/route.ts
 * export { GET, PATCH } from '@revnixhq/nextly/api/email-templates-layout';
 * ```
 *
 * @module api/email-templates-layout
 */

import { container } from "../di";
import { getCachedNextly } from "../init";
import type { EmailTemplateService } from "../services/email/email-template-service";

import { requireAuthHeader } from "./auth-header-only";
import { readJsonBody } from "./read-json-body";
import { respondAction, respondData } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

async function getEmailTemplateService(): Promise<EmailTemplateService> {
  await getCachedNextly();
  return container.get<EmailTemplateService>("emailTemplateService");
}

/**
 * GET handler for retrieving the shared email layout (header + footer).
 *
 * Requires authentication. Returns the `htmlContent` of the reserved
 * `_email-header` and `_email-footer` template rows. Returns empty
 * strings if layout templates haven't been created yet.
 *
 * Response Codes:
 * - 200 OK: Layout retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 500 Internal Server Error: Failed to fetch layout
 *
 * Response: `{ "data": { "header": string, "footer": string } }`
 */
export const GET = withErrorHandler(
  async (request: Request): Promise<Response> => {
    requireAuthHeader(request);

    const service = await getEmailTemplateService();
    const layout = await service.getLayout();

    // Layout is a singleton structured value (header + footer); ship it
    // bare via respondData for the non-CRUD read shape.
    return respondData(layout);
  }
);

/**
 * PATCH handler for updating the shared email header and/or footer.
 *
 * Requires authentication. Creates layout templates if they don't exist
 * yet (upsert behavior). Both fields are optional; only provided fields
 * are updated.
 *
 * Request Body (all fields optional):
 * - header: HTML content for the shared email header
 * - footer: HTML content for the shared email footer
 *
 * Response Codes:
 * - 200 OK: Layout updated successfully
 * - 400 Bad Request: Invalid JSON body
 * - 401 Unauthorized: Authentication required
 * - 500 Internal Server Error: Update failed
 *
 * Response: `{ "data": { "header": string, "footer": string } }`; the
 * full layout after update (re-read from the service).
 */
export const PATCH = withErrorHandler(
  async (request: Request): Promise<Response> => {
    requireAuthHeader(request);

    const service = await getEmailTemplateService();

    const body = await readJsonBody<Record<string, unknown>>(request);

    // Selective string-typed copy: a non-string value silently drops the
    // field rather than triggering a 400 (matches pre-migration behavior).
    const updateData: { header?: string; footer?: string } = {};
    if (typeof body.header === "string") updateData.header = body.header;
    if (typeof body.footer === "string") updateData.footer = body.footer;

    await service.updateLayout(updateData);

    // Re-read so the response reflects the persisted state including any
    // upserted rows the legacy contract returned.
    const layout = await service.getLayout();

    // Layout update is a non-CRUD mutation (no resource identity, just
    // an upsert of the singleton). Match the dispatcher's `respondAction`
    // shape but include the post-update layout so the admin doesn't need
    // a follow-up GET.
    return respondAction("Email layout updated.", { layout });
  }
);
