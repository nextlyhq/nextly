/**
 * Email Send-With-Template API Route Handler for Next.js
 *
 * Sends an email rendered from a named template.
 * Re-export in your Next.js application at /api/email/send-with-template.
 *
 * @example
 * ```typescript
 * // app/api/email/send-with-template/route.ts
 * export { POST } from '@revnixhq/nextly/api/email-send-template';
 * ```
 *
 * Wire shape: Phase 4 Task 11 migrates this handler off the legacy
 * `{ data: <result> }` envelope onto `respondAction` (spec §5.1). The
 * service returns `{ success, messageId? }`; the body surfaces both
 * fields plus the resolved template id alongside a server-authored
 * toast. Auth uses the existing `requireAuthentication` middleware
 * bridged to `NextlyError` via `toNextlyAuthError`. Validation flows
 * through `nextlyValidationFromZod` (F11). The attachment resolver
 * throws `NextlyError` directly (validation for caller-fixable
 * failures, internal for storage I/O); `withErrorHandler` produces the
 * canonical problem+json envelope. The machine-readable
 * `EMAIL_ATTACHMENT_*` code lives at `error.data.errors[0].code`.
 *
 * @module api/email-send-template
 */

import { z } from "zod";

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import type { EmailService } from "../services/email/email-service";

import { respondAction } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

async function getEmailService(): Promise<EmailService> {
  await getCachedNextly();
  return container.get<EmailService>("emailService");
}

const attachmentInputSchema = z.object({
  mediaId: z.string().min(1, "mediaId is required"),
  filename: z.string().min(1).optional(),
});

const sendTemplateSchema = z.object({
  to: z.string().email("A valid recipient email is required"),
  template: z.string().min(1, "template slug is required"),
  variables: z.record(z.string(), z.unknown()).optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  providerId: z.string().optional(),
  attachments: z.array(attachmentInputSchema).optional(),
});

/**
 * POST handler for sending an email using a template.
 *
 * Request body:
 * - `to` (string, required): Recipient email address
 * - `template` (string, required): Template slug
 * - `variables` (object, optional): Interpolation variables
 * - `cc` / `bcc` (string[], optional)
 * - `providerId` (string, optional)
 * - `attachments` (array, optional): `[{ mediaId, filename? }]`
 *
 * Response codes:
 * - 200 OK: `{ message, success, messageId?, templateId }` via `respondAction`.
 * - 400 Bad Request: invalid body / attachment count or size exceeded / mediaId not found.
 * - 401 Unauthorized.
 * - 500 Internal Server Error: storage read failed or provider error.
 */
export const POST = withErrorHandler(
  async (request: Request): Promise<Response> => {
    const authResult = await requireAuthentication(request);
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    let raw: unknown;
    try {
      raw = await request.json();
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

    let args: z.infer<typeof sendTemplateSchema>;
    try {
      args = sendTemplateSchema.parse(raw);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const service = await getEmailService();
    const result = await service.sendWithTemplate(
      args.template,
      args.to,
      args.variables ?? {},
      {
        providerId: args.providerId,
        cc: args.cc,
        bcc: args.bcc,
        attachments: args.attachments,
      }
    );
    // Phase 4: respondAction. Spread the service result and surface the
    // resolved template slug so callers can correlate the queued message
    // back to the request without storing the original payload.
    return respondAction("Email queued.", {
      ...result,
      templateId: args.template,
    });
  }
);
