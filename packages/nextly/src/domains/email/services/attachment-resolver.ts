/**
 * Attachment Resolver
 *
 * Converts caller-facing `EmailAttachmentInput[]` into `ResolvedAttachment[]`
 * (bytes in memory, ready to forward to a provider adapter).
 *
 * Validation runs in order, fails fast — failures throw `NextlyError`:
 * 1. Count ≤ `limits.maxCount` (else `VALIDATION_ERROR` w/
 *    `errors[0].code = EMAIL_ATTACHMENT_COUNT_EXCEEDED`)
 * 2. Each `mediaId` resolves to a record (else `VALIDATION_ERROR` w/
 *    `errors[0].code = EMAIL_ATTACHMENT_MEDIA_NOT_FOUND`)
 * 3. Each file reads cleanly from storage (else `INTERNAL_ERROR` w/
 *    `logContext.emailAttachmentCode = EMAIL_ATTACHMENT_STORAGE_READ_FAILED`)
 * 4. Total bytes ≤ `limits.maxTotalBytes` (else `VALIDATION_ERROR` w/
 *    `errors[0].code = EMAIL_ATTACHMENT_SIZE_EXCEEDED`)
 *
 * Injected `findMedia` and `readBytes` keep the resolver agnostic of
 * the concrete `MediaService` / `IStorageAdapter` shapes — easy to mock
 * in tests and easy to swap if either dependency is refactored.
 *
 * @module domains/email/services/attachment-resolver
 */

import { NextlyError } from "../../../errors";
import { EmailErrorCode } from "../errors";
import type { EmailAttachmentInput, ResolvedAttachment } from "../types";

import type { AttachmentLimits } from "./attachment-limits";

/**
 * Minimal media record needed to resolve an attachment. Subset of
 * `MediaFile` so the resolver doesn't need the full type surface.
 */
export interface AttachmentMediaRecord {
  /** Storage path/key — what `readBytes` expects. */
  filename: string;
  /** User-facing filename; used when the input doesn't override. */
  originalFilename: string;
  /** MIME type forwarded to the provider. */
  mimeType: string;
}

export interface ResolveAttachmentsDeps {
  limits: AttachmentLimits;
  /**
   * Look up a media record by ID. Returns `null` for not-found (the resolver
   * surfaces that as `NextlyError.validation` with
   * `errors[0].code = EMAIL_ATTACHMENT_MEDIA_NOT_FOUND`).
   */
  findMedia: (mediaId: string) => Promise<AttachmentMediaRecord | null>;
  /**
   * Read raw bytes from storage. Should throw on any failure — the resolver
   * wraps into `NextlyError.internal` with
   * `logContext.emailAttachmentCode = EMAIL_ATTACHMENT_STORAGE_READ_FAILED`.
   */
  readBytes: (storagePath: string) => Promise<Buffer>;
}

export async function resolveAttachments(
  inputs: EmailAttachmentInput[],
  deps: ResolveAttachmentsDeps
): Promise<ResolvedAttachment[]> {
  if (inputs.length > deps.limits.maxCount) {
    throw NextlyError.validation({
      errors: [
        {
          path: "attachments",
          code: EmailErrorCode.ATTACHMENT_COUNT_EXCEEDED,
          message: "Too many attachments.",
        },
      ],
      logContext: {
        emailAttachmentCode: EmailErrorCode.ATTACHMENT_COUNT_EXCEEDED,
        given: inputs.length,
        max: deps.limits.maxCount,
      },
    });
  }

  const resolved: ResolvedAttachment[] = [];
  for (const input of inputs) {
    const media = await deps.findMedia(input.mediaId);
    if (!media) {
      throw NextlyError.validation({
        errors: [
          {
            path: "attachments",
            code: EmailErrorCode.ATTACHMENT_MEDIA_NOT_FOUND,
            message: "Attachment file not found.",
          },
        ],
        logContext: {
          emailAttachmentCode: EmailErrorCode.ATTACHMENT_MEDIA_NOT_FOUND,
          mediaId: input.mediaId,
        },
      });
    }

    let content: Buffer;
    try {
      content = await deps.readBytes(media.filename);
    } catch (err) {
      throw NextlyError.internal({
        cause: err instanceof Error ? err : undefined,
        logContext: {
          emailAttachmentCode: EmailErrorCode.ATTACHMENT_STORAGE_READ_FAILED,
          mediaId: input.mediaId,
          ...(err instanceof Error ? {} : { causeValue: String(err) }),
        },
      });
    }

    resolved.push({
      filename: input.filename ?? media.originalFilename,
      mimeType: media.mimeType,
      content,
    });
  }

  const totalBytes = resolved.reduce((sum, a) => sum + a.content.length, 0);
  if (totalBytes > deps.limits.maxTotalBytes) {
    throw NextlyError.validation({
      errors: [
        {
          path: "attachments",
          code: EmailErrorCode.ATTACHMENT_SIZE_EXCEEDED,
          message: "Total attachment size exceeds the limit.",
        },
      ],
      logContext: {
        emailAttachmentCode: EmailErrorCode.ATTACHMENT_SIZE_EXCEEDED,
        totalBytes,
        max: deps.limits.maxTotalBytes,
      },
    });
  }

  return resolved;
}
