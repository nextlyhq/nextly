/**
 * Email Template Draft Preview API Route Handler for Next.js
 *
 * Renders template FIELDS with sample data, without requiring the template to
 * have been saved. Re-export in your Next.js application at
 * /api/email-templates/preview.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-templates/preview/route.ts
 * export { POST } from 'nextly/api/email-templates-draft-preview';
 * ```
 *
 * Separate from `/api/email-templates/[id]/preview` because that one reads the
 * STORED row: it cannot show unsaved edits, and while a template is being
 * created there is no row to address. Both render through the same composition,
 * so the two previews cannot disagree with each other or with what is sent.
 *
 * The rendered subject/html/text stay JSON-encoded (no raw HTML response); the
 * admin renders the preview inside a sandboxed iframe.
 *
 * @module api/email-templates-draft-preview
 */

import { z } from "zod";

import { container } from "../di";
import { getCachedNextly } from "../init";
import type { EmailTemplateService } from "../services/email/email-template-service";

import { readJsonBody } from "./read-json-body";
import { respondData } from "./response-shapes";
import { requireRouteAnyPermission } from "./route-auth";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

async function getEmailTemplateService(): Promise<EmailTemplateService> {
  await getCachedNextly();
  return container.get<EmailTemplateService>("emailTemplateService");
}

/**
 * The fields a render needs, and nothing else.
 *
 * Deliberately not the full template shape: a preview never writes, so
 * accepting a name, a slug or an id would take input it has no use for.
 */
const draftPreviewSchema = z.object({
  template: z.object({
    subject: z.string(),
    htmlContent: z.string(),
    plainTextContent: z.string().nullable().default(null),
    preheader: z.string().nullable().default(null),
    useLayout: z.boolean(),
    kind: z.enum(["template", "layout", "partial"]),
    layoutId: z.string().nullable().default(null),
  }),
  data: z.record(z.string(), z.unknown()),
});

/**
 * POST handler for previewing unsaved email template fields.
 *
 * Renders the supplied fields by replacing `{{variable}}` placeholders with
 * values from `data`, wrapping in the resolved layout when `useLayout` is set,
 * prepending the hidden preheader, and deriving the plain-text alternative —
 * the same composition the send path uses.
 *
 * Requires authentication. Gated on the same permissions as the saved-template
 * preview: previewing a draft reveals no more than previewing a stored row.
 *
 * Request Body:
 * - template: the fields to render (required)
 * - data: key-value pairs for variable interpolation (required)
 *
 * Response Codes:
 * - 200 OK: Preview rendered successfully
 * - 400 Bad Request: Invalid input
 * - 401 Unauthorized: Authentication required
 * - 500 Internal Server Error: Preview failed
 *
 * Response: `{ "subject": string, "html": string, "text": string }`
 */
export const POST = withErrorHandler(
  async (request: Request): Promise<Response> => {
    await requireRouteAnyPermission(request, [
      { action: "create", resource: "email-templates" },
      { action: "manage", resource: "email-templates" },
    ]);

    const service = await getEmailTemplateService();
    const body = await readJsonBody(request);

    let validated: z.infer<typeof draftPreviewSchema>;
    try {
      validated = draftPreviewSchema.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const preview = await service.previewDraft(
      validated.template,
      validated.data
    );

    return respondData(preview);
  }
);
