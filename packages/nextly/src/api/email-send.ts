/**
 * Email Send API Route Handler for Next.js
 *
 * Sends a raw email through the default (or specified) provider.
 * Re-export in your Next.js application at /api/email/send.
 *
 * @example
 * ```typescript
 * // app/api/email/send/route.ts
 * export { POST } from 'nextly/api/email-send';
 * ```
 *
 * The service returns `{ success, messageId? }`; the `messageId` is the
 * useful caller-facing field, paired with a server-authored toast via
 * `respondAction`. The attachment resolver throws `NextlyError` directly
 * (validation for caller-fixable failures, internal for storage I/O); the
 * machine-readable `EMAIL_ATTACHMENT_*` code lives at
 * `error.data.errors[0].code`.
 *
 * @module api/email-send
 */

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

const sendEmailSchema = sendRequestSchema({
  subject: z.string().min(1, "subject is required"),
  html: z.string().min(1, "html is required"),
  plainText: z.string().optional(),
});

/**
 * POST handler for sending a raw email.
 *
 * Request body:
 * - `to` (string or string[], required): Recipient email address, or several
 * - `from` / `replyTo` (string, optional): the send's sender and Reply-To
 * - `subject` (string, required)
 * - `html` (string, required)
 * - `plainText` (string, optional)
 * - `cc` / `bcc` (string[], optional)
 * - `providerId` (string, optional): use a specific email provider
 * - `attachments` (array, optional): `[{ mediaId, filename? }]`
 * - `idempotencyKey` (string, optional): send this message once for the key;
 *   a repeat answers `repeat: true` and sends nothing. The key is the
 *   caller's own (its API key, or the signed-in person), so it never meets
 *   the site's keys or another caller's.
 *
 * Response codes:
 * - 200 OK: `{ message, success, messageId? }` via `respondAction`.
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
      // Legacy: 400 INVALID_JSON. Canonical: VALIDATION_ERROR with a single
      // empty-path entry coded `invalid_json` so callers see the real cause
      // rather than a misleading "to is required" downstream.
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

    let args: z.infer<typeof sendEmailSchema>;
    try {
      args = sendEmailSchema.parse(raw);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const service = await getEmailService();
    // A key sent here is this caller's own: it never meets a key the site's
    // code sends with, nor another caller's.
    const result = await scopedSender(service, restKeyScope(authResult)).send(
      args
    );
    // The service constructs its public result explicitly, so this spread
    // carries only `{ success, messageId? }` — never a provider's own extra
    // fields. Spread onto the action
    // body so consumers that read `messageId` and `success` keep working
    // alongside the server-authored toast string.
    // Says what happened: the send is synchronous, so by now the provider has
    // accepted the message or it has failed. Nothing is queued.
    return respondAction(sendOutcomeMessage(result.success), { ...result });
  }
);
