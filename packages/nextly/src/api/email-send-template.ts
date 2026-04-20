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
 * @module api/email-send-template
 */

import { z } from "zod";

import {
  createJsonErrorResponse,
  isErrorResponse,
  requireAuthentication,
} from "../auth/middleware";
import { container } from "../di";
import { EmailAttachmentError, EmailErrorCode } from "../domains/email/errors";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import type { EmailService } from "../services/email/email-service";

// ============================================================
// Helpers
// ============================================================

async function getEmailService(): Promise<EmailService> {
  await getNextly();
  return container.get<EmailService>("emailService");
}

function errorResponse(
  message: string,
  statusCode: number,
  code?: string
): Response {
  return Response.json(
    { error: { message, ...(code && { code }) } },
    {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function handleError(error: unknown): Response {
  console.error(`[Email Send Template API] error:`, error);

  if (error instanceof EmailAttachmentError) {
    const clientFacing: readonly EmailErrorCode[] = [
      EmailErrorCode.ATTACHMENT_COUNT_EXCEEDED,
      EmailErrorCode.ATTACHMENT_SIZE_EXCEEDED,
      EmailErrorCode.ATTACHMENT_MEDIA_NOT_FOUND,
    ];
    if (clientFacing.includes(error.code)) {
      return errorResponse(error.message, 400, error.code);
    }
    return errorResponse(error.message, 500, error.code);
  }

  if (isServiceError(error)) {
    return errorResponse(error.message, error.httpStatus, error.code);
  }

  if (error instanceof z.ZodError) {
    const first = error.issues[0];
    return errorResponse(
      first?.message ?? "Validation error",
      400,
      "VALIDATION_ERROR"
    );
  }

  if (error instanceof Error) {
    if (error.message.includes("Services not initialized")) {
      return errorResponse(error.message, 503, "SERVICE_UNAVAILABLE");
    }
    return errorResponse(error.message, 500);
  }

  return errorResponse("Failed to send email", 500);
}

// ============================================================
// Validation
// ============================================================

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

// ============================================================
// Route Handler
// ============================================================

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
 * - 200 OK: `{ success, messageId? }`
 * - 400 Bad Request: invalid body / attachment count or size exceeded / mediaId not found
 * - 401 Unauthorized
 * - 500 Internal Server Error: storage read failed or provider error
 * - 503 Service Unavailable: services not initialized
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const authResult = await requireAuthentication(request);
    if (isErrorResponse(authResult)) {
      return createJsonErrorResponse(authResult);
    }

    let raw: unknown = {};
    try {
      raw = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
    }

    const args = sendTemplateSchema.parse(raw);
    const service = await getEmailService();

    const result = await service.sendWithTemplate(
      args.template,
      args.to,
      (args.variables ?? {}) as Record<string, unknown>,
      {
        providerId: args.providerId,
        cc: args.cc,
        bcc: args.bcc,
        attachments: args.attachments,
      }
    );

    return Response.json(
      { data: result },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
