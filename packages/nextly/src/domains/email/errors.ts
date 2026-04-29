/**
 * Email Domain Error Codes
 *
 * Stable machine-readable codes for email operations. Surfaced at
 * `error.data.errors[0].code` on validation responses (count/size/media
 * limit) and in `logContext.emailAttachmentCode` on internal responses
 * (storage I/O).
 *
 * Attachment-specific codes let callers distinguish "media missing" from
 * "file too large" from "storage unreachable" without string matching.
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
