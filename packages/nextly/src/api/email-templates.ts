/**
 * Email Templates API Route Handlers for Next.js
 *
 * These route handlers can be re-exported in your Next.js application to provide
 * email template management endpoints at /api/email-templates.
 *
 * Services are auto-initialized on first request using environment variables:
 * - DB_DIALECT: Database dialect ("postgresql" | "mysql" | "sqlite")
 * - DATABASE_URL: Database connection string
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-templates/route.ts
 * export { GET, POST } from '@revnixhq/nextly/api/email-templates';
 * ```
 *
 * Wire shape — Task 21 migration: handlers wrap `withErrorHandler` and return
 * the canonical `{ data: <result> }` envelope per spec §10.2. The legacy
 * `meta: { total }` synthetic field on the GET list is dropped — listing
 * returns every template the caller can see and admin code can call
 * `data.length` directly. Validation failures route through
 * `nextlyValidationFromZod` (F11).
 *
 * @module api/email-templates
 */

import { z } from "zod";

import { container } from "../di";
import { getNextly } from "../init";
import type { EmailTemplateService } from "../services/email/email-template-service";

import { requireAuthHeader } from "./auth-header-only";
import { createSuccessResponse } from "./create-success-response";
import { readJsonBody } from "./read-json-body";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

async function getEmailTemplateService(): Promise<EmailTemplateService> {
  await getNextly();
  return container.get<EmailTemplateService>("emailTemplateService");
}

const variableSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  required: z.boolean().optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(255)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must be lowercase alphanumeric with hyphens"
    ),
  subject: z.string().min(1, "Subject is required").max(500),
  htmlContent: z.string().min(1, "HTML content is required"),
  plainTextContent: z.string().optional().nullable(),
  variables: z.array(variableSchema).optional().nullable(),
  useLayout: z.boolean().optional(),
  isActive: z.boolean().optional(),
  providerId: z.string().uuid().optional().nullable(),
});

/**
 * GET handler for listing all email templates.
 *
 * Requires authentication. Returns all templates except layout templates
 * (`_email-header`, `_email-footer`). Use the layout endpoint to access those.
 *
 * Response Codes:
 * - 200 OK: Templates list retrieved successfully
 * - 401 Unauthorized: Authentication required
 * - 500 Internal Server Error: Failed to fetch templates
 *
 * Response: `{ "data": EmailTemplate[] }` — non-paginated list (the legacy
 * `meta: { total }` is dropped per Task 21 §10.1).
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer <token>" \
 *   "http://localhost:3000/api/email-templates"
 * # => {"data":[...]}
 * ```
 */
export const GET = withErrorHandler(
  async (request: Request): Promise<Response> => {
    requireAuthHeader(request);

    const service = await getEmailTemplateService();
    const templates = await service.listTemplates();

    return createSuccessResponse(templates);
  }
);

/**
 * POST handler for creating a new email template.
 *
 * Requires authentication. Cannot use reserved slugs (`_email-header`,
 * `_email-footer`) — use the layout endpoint instead.
 *
 * Request Body: see `createTemplateSchema` above for the full shape.
 *
 * Response Codes:
 * - 201 Created: Template created successfully
 * - 400 Bad Request: Invalid input or reserved slug
 * - 401 Unauthorized: Authentication required
 * - 500 Internal Server Error: Creation failed
 *
 * Response: `{ "data": EmailTemplate }` — created template. Status 201.
 */
export const POST = withErrorHandler(
  async (request: Request): Promise<Response> => {
    requireAuthHeader(request);

    const body = await readJsonBody(request);

    let validated: z.infer<typeof createTemplateSchema>;
    try {
      validated = createTemplateSchema.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const service = await getEmailTemplateService();
    const template = await service.createTemplate(validated);

    return createSuccessResponse(template, { status: 201 });
  }
);
