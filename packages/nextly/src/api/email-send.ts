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
import {
  MAX_IDEMPOTENCY_KEY_LENGTH,
  scopedSender,
  SITE_KEY_SCOPE,
} from "../domains/email/send-claims";
import { sendOutcomeMessage } from "../domains/email/send-outcome";
import {
  isSendableAddress,
  isSendableAddressList,
} from "../domains/email/services/recipients";
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

// One address, or a comma-joined list of them, as the service reads a `to`
// entry: both routes accept exactly what every other way of sending does.
const recipientSchema = z
  .string()
  .refine(isSendableAddressList, "A valid recipient email is required");

const attachmentInputSchema = z.object({
  mediaId: z.string().min(1, "mediaId is required"),
  filename: z.string().min(1).optional(),
});

const sendEmailSchema = z.object({
  // One address, as before, or several: every one receives the email.
  // Checked as the service checks it, so the route and the service agree on
  // what a sendable address is (`dev@localhost`, `Name <user@example.com>`).
  to: z.union([
    recipientSchema,
    z.array(recipientSchema).min(1, "At least one recipient is required"),
  ]),
  subject: z.string().min(1, "subject is required"),
  html: z.string().min(1, "html is required"),
  plainText: z.string().optional(),
  // The send's own sender and Reply-To. Either may carry a display name
  // (`Name <user@example.com>`), so the mailbox inside it is what is checked.
  from: z
    .string()
    .trim()
    .refine(isSendableAddress, "from must be an email address")
    .optional(),
  replyTo: z
    .string()
    .trim()
    .refine(isSendableAddress, "replyTo must be an email address")
    .optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  providerId: z.string().optional(),
  attachments: z.array(attachmentInputSchema).optional(),
  // Sends this message once for the key; checked again by the service.
  idempotencyKey: z.string().min(1).max(MAX_IDEMPOTENCY_KEY_LENGTH).optional(),
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
 *
 * Response codes:
 * - 200 OK: `{ message, success, messageId? }` via `respondAction`.
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
    // A key sent here is the site's, as one from the Direct API is.
    const result = await scopedSender(service, SITE_KEY_SCOPE).send(args);
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
