/**
 * Email Domain Error Codes
 *
 * Stable machine-readable codes for email operations. Attachment-specific
 * codes let callers distinguish "media missing" from "file too large" from
 * "storage unreachable" without string matching.
 *
 * @module domains/email/errors
 */

export const EmailErrorCode = {
  ATTACHMENT_COUNT_EXCEEDED: "EMAIL_ATTACHMENT_COUNT_EXCEEDED",
  ATTACHMENT_SIZE_EXCEEDED: "EMAIL_ATTACHMENT_SIZE_EXCEEDED",
  ATTACHMENT_MEDIA_NOT_FOUND: "EMAIL_ATTACHMENT_MEDIA_NOT_FOUND",
  ATTACHMENT_STORAGE_READ_FAILED: "EMAIL_ATTACHMENT_STORAGE_READ_FAILED",
} as const;

export type EmailErrorCode =
  (typeof EmailErrorCode)[keyof typeof EmailErrorCode];

/**
 * Attachment-related error thrown by the resolution pipeline.
 *
 * Propagates out past `EmailService.send()`'s try/catch so callers can
 * distinguish "send succeeded / send failed / attachment rejected".
 */
export class EmailAttachmentError extends Error {
  constructor(
    public readonly code: EmailErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "EmailAttachmentError";
  }
}

/**
 * Narrow unknown errors into `EmailAttachmentError` instances.
 */
export function isEmailAttachmentError(
  error: unknown
): error is EmailAttachmentError {
  return error instanceof EmailAttachmentError;
}
