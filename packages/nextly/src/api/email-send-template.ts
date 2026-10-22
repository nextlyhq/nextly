/**
 * Email Send-With-Template API Route Handler for Next.js
 *
 * Sends an email rendered from a named template.
 * Re-export in your Next.js application at /api/email/send-with-template.
 *
 * @example
 * ```typescript
 * // app/api/email/send-with-template/route.ts
 * export { POST } from 'nextly/api/email-send-template';
 * ```
 *
 * The service returns `{ success, messageId? }`; the body surfaces both
 * fields plus the resolved template id alongside a server-authored toast
 * via `respondAction`. The attachment resolver throws `NextlyError`
 * directly (validation for caller-fixable failures, internal for storage
 * I/O); the machine-readable `EMAIL_ATTACHMENT_*` code lives at
 * `error.data.errors[0].code`.
 *
 * @module api/email-send-template
 */
// The handler's preamble (authenticate, read the JSON body, parse it) is the
// one the raw send route runs too, as other action routes do; the send fields
// themselves are shared from `domains/email/send-request`.
// fallow-ignore-file code-duplication

import { z } from "zod";

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import { restKeyScope, scopedSender } from "../domains/email/send-claims";
import { sendOutcomeMessage } from "../domains/email/send-outcome";
import { sendRequestSchema } from "../domains/email/send-request";
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

const sendTemplateSchema = sendRequestSchema({
  template: z.string().min(1, "template slug is required"),
  variables: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST handler for sending an email using a template.
 *
 * Request body:
 * - `to` (string or string[], required): Recipient email address, or several
 * - `from` / `replyTo` (string, optional): the send's sender and Reply-To
 * - `template` (string, required): Template slug
 * - `variables` (object, optional): Interpolation variables
 * - `cc` / `bcc` (string[], optional)
 * - `providerId` (string, optional)
 * - `attachments` (array, optional): `[{ mediaId, filename? }]`
 * - `idempotencyKey` (string, optional): send this message once for the key;
 *   a repeat answers `repeat: true` and sends nothing. The key is the
 *   caller's own (its API key, or the signed-in person), so it never meets
 *   the site's keys or another caller's.
 *
 * Response codes:
 * - 200 OK: `{ message, success, messageId?, templateId }` via `respondAction`.
 * - 400 Bad Request: invalid body / attachment count or size exceeded / mediaId not found.
 * - 401 Unauthorized.
 * - 409 Conflict: the idempotency key was used for a different message.
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
    // A key sent here is this caller's own: it never meets a key the site's
    // code sends with, nor another caller's.
    const result = await scopedSender(
      service,
      restKeyScope(authResult)
    ).sendWithTemplate(args.template, args.to, args.variables ?? {}, {
      providerId: args.providerId,
      from: args.from,
      replyTo: args.replyTo,
      cc: args.cc,
      bcc: args.bcc,
      attachments: args.attachments,
      idempotencyKey: args.idempotencyKey,
    });
    // Spread the service result and surface the resolved template slug so
    // callers can correlate the message back to the request without storing
    // the original payload. The message says what happened, as on the raw
    // send route.
    return respondAction(sendOutcomeMessage(result.success), {
      ...result,
      templateId: args.template,
    });
  }
);
