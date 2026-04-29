import {
  type EmailAttachmentError,
  EmailErrorCode,
} from "../domains/email/errors";
import { NextlyError } from "../errors/nextly-error";

/**
 * Convert an `EmailAttachmentError` into the equivalent `NextlyError` for
 * the unified-error-system migration.
 *
 * Three of the four `EmailErrorCode` values are caller-fixable
 * (count/size limit, missing media) and surface as
 * `NextlyError.validation` with a single field-level entry: the
 * `EmailErrorCode` in `errors[0].code` so admin clients can branch
 * machine-readably without parsing the public message. The fourth
 * (storage read failure) is operator-actionable and surfaces as
 * `NextlyError.internal` with the original error in `logContext`.
 *
 * The legacy wire shape carried `EMAIL_ATTACHMENT_*` at the response
 * top-level `code` field. The canonical Task 21 envelope nests it under
 * `error.data.errors[0].code` instead — admin code that branches on the
 * original code must read it from there. This is a wire-shape change
 * documented in the F12-style admin gap for Task 10.
 *
 * Hoisted because both `email-send.ts` and `email-send-template.ts` need
 * the conversion; F11 established the precedent that any 2+ duplicate
 * route helper lives in a shared module. The whole helper is deleted
 * when Task 11 migrates `EmailAttachmentError` → `NextlyError`.
 */
export function nextlyErrorFromEmailAttachment(
  err: EmailAttachmentError
): NextlyError {
  // The "details" Record is the operator payload — preserve it verbatim
  // in logContext so triage retains the failed mediaId, attempted size,
  // limit, etc. The same fields stay out of the wire body per §13.8.
  const logContext: Record<string, unknown> = {
    emailAttachmentCode: err.code,
    ...(err.details ?? {}),
  };

  const clientFacing: readonly EmailErrorCode[] = [
    EmailErrorCode.ATTACHMENT_COUNT_EXCEEDED,
    EmailErrorCode.ATTACHMENT_SIZE_EXCEEDED,
    EmailErrorCode.ATTACHMENT_MEDIA_NOT_FOUND,
  ];

  if (clientFacing.includes(err.code)) {
    return NextlyError.validation({
      // `errors[0].path` is `attachments` so admin can highlight the
      // attachments form section. The per-field message preserves the
      // legacy text — Task 11 will rewrite the source-throw messages to
      // strict §13.8 form (no identifiers) when EmailAttachmentError is
      // collapsed into NextlyError.
      errors: [
        {
          path: "attachments",
          code: err.code,
          message: err.message,
        },
      ],
      logContext,
    });
  }

  // ATTACHMENT_STORAGE_READ_FAILED and any future operator-only codes
  // surface as a 500. The original error is forwarded as `cause` so the
  // wrapper's logger captures the stack trace.
  return NextlyError.internal({ cause: err, logContext });
}
