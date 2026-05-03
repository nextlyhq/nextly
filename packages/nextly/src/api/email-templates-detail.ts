/**
 * Email Templates Detail API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * individual email template management endpoints at /api/email-templates/[id].
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-templates/[id]/route.ts
 * export { GET, PATCH, DELETE } from '@revnixhq/nextly/api/email-templates-detail';
 * ```
 *
 * @module api/email-templates-detail
 */

import { container } from "../di";
import { getCachedNextly } from "../init";
import type { EmailTemplateService } from "../services/email/email-template-service";

import { requireAuthHeader } from "./auth-header-only";
import { readJsonBody } from "./read-json-body";
import {
  respondAction,
  respondDoc,
  respondMutation,
} from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getEmailTemplateService(): Promise<EmailTemplateService> {
  await getCachedNextly();
  return container.get<EmailTemplateService>("emailTemplateService");
}

/**
 * GET handler for retrieving a single email template by ID.
 *
 * Requires authentication.
 *
 * Response Codes:
 * - 200 OK: Template retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Template with ID does not exist
 * - 500 Internal Server Error: Failed to fetch template
 *
 * Response: `{ "data": EmailTemplate }`
 */
export const GET = withErrorHandler(
  async (request: Request, context: RouteContext): Promise<Response> => {
    requireAuthHeader(request);

    const { id } = await context.params;
    const service = await getEmailTemplateService();
    const template = await service.getTemplate(id);

    return respondDoc(template);
  }
);

/**
 * PATCH handler for updating an email template.
 *
 * Requires authentication. Template `slug` cannot be changed after creation.
 *
 * Request Body (all fields optional):
 * - name, subject, htmlContent, plainTextContent, variables, useLayout,
 *   isActive, providerId.
 *
 * Response Codes:
 * - 200 OK: Template updated successfully
 * - 400 Bad Request: Invalid JSON body
 * - 401 Unauthorized: Authentication required
 * - 404 Not Found: Template with ID does not exist
 * - 500 Internal Server Error: Update failed
 *
 * Response: `{ "data": EmailTemplate }`
 */
export const PATCH = withErrorHandler(
  async (request: Request, context: RouteContext): Promise<Response> => {
    requireAuthHeader(request);

    const { id } = await context.params;
    const body = await readJsonBody<Record<string, unknown>>(request);

    // Selective copy: only forward fields the legacy handler accepted, so
    // unknown keys are silently ignored (matches the pre-migration contract).
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.subject !== undefined) updateData.subject = body.subject;
    if (body.htmlContent !== undefined)
      updateData.htmlContent = body.htmlContent;
    if (body.plainTextContent !== undefined)
      updateData.plainTextContent = body.plainTextContent;
    if (body.variables !== undefined) updateData.variables = body.variables;
    if (body.useLayout !== undefined) updateData.useLayout = body.useLayout;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.providerId !== undefined) updateData.providerId = body.providerId;

    const service = await getEmailTemplateService();
    const template = await service.updateTemplate(id, updateData);

    return respondMutation("Email template updated.", template);
  }
);

/**
 * DELETE handler for removing an email template.
 *
 * Requires authentication. Cannot delete layout templates (`_email-header`,
 * `_email-footer`); use the layout endpoint to modify them.
 *
 * Response Codes:
 * - 200 OK: Template deleted successfully
 * - 401 Unauthorized: Authentication required
 * - 403 Forbidden: Cannot delete layout templates
 * - 404 Not Found: Template with ID does not exist
 * - 500 Internal Server Error: Deletion failed
 *
 * Response: `{ "data": { "success": true } }`
 */
export const DELETE = withErrorHandler(
  async (request: Request, context: RouteContext): Promise<Response> => {
    requireAuthHeader(request);

    const { id } = await context.params;
    const service = await getEmailTemplateService();

    await service.deleteTemplate(id);

    // Service returns void. Echo the deleted id (named `templateId` to
    // match the dispatcher route's wire shape) so the admin can prune
    // its local list without a follow-up fetch.
    return respondAction("Email template deleted.", { templateId: id });
  }
);
