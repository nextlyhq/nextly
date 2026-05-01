/**
 * Email Send API Route Handler for Next.js
 *
 * Sends a raw email through the default (or specified) provider.
 * Re-export in your Next.js application at /api/email/send.
 *
 * @example
 * ```typescript
 * // app/api/email/send/route.ts
 * export { POST } from '@revnixhq/nextly/api/email-send';
 * ```
 *
 * Wire shape — Task 21 migration: handler wraps `withErrorHandler` and
 * returns the canonical `{ data: <result> }` envelope per spec §10.2.
 * Auth uses the existing `requireAuthentication` middleware bridged to
 * `NextlyError` via `toNextlyAuthError`. Validation errors flow through
 * `nextlyValidationFromZod` (F11). The attachment resolver throws
 * `NextlyError` directly (validation for caller-fixable failures,
 * internal for storage I/O) — `withErrorHandler` produces the canonical
 * envelope. The machine-readable `EMAIL_ATTACHMENT_*` code lives at
 * `error.data.errors[0].code`.
 *
 * @module api/email-send
 */

import { z } from "zod";

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import type { EmailService } from "../services/email/email-service";

import { createSuccessResponse } from "./create-success-response";
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

const sendEmailSchema = z.object({
  to: z.string().email("A valid recipient email is required"),
  subject: z.string().min(1, "subject is required"),
  html: z.string().min(1, "html is required"),
  plainText: z.string().optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  providerId: z.string().optional(),
  attachments: z.array(attachmentInputSchema).optional(),
});

/**
 * POST handler for sending a raw email.
 *
 * Request body:
 * - `to` (string, required): Recipient email address
 * - `subject` (string, required)
 * - `html` (string, required)
 * - `plainText` (string, optional)
 * - `cc` / `bcc` (string[], optional)
 * - `providerId` (string, optional): use a specific email provider
 * - `attachments` (array, optional): `[{ mediaId, filename? }]`
 *
 * Response codes:
 * - 200 OK: `{ data: { success, messageId? } }`
 * - 400 Bad Request: invalid body / attachment count or size exceeded / mediaId not found
 * - 401 Unauthorized
 * - 500 Internal Server Error: storage read failed or provider error
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
    const result = await service.send(args);
    return createSuccessResponse(result);
  }
);
