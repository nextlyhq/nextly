/**
 * Attachment Limits
 *
 * Reads the maximum attachment count and total-size cap from env vars.
 * Invalid or missing values fall back to conservative defaults that sit
 * safely below every supported provider's hard cap (Resend 40 MB, SMTP
 * ~25 MB typical, SendLayer ~50 MB).
 *
 * Env var names match Nextly's `NEXTLY_*` convention (see
 * `date-formatting.ts`, `collection-metadata-service.ts`).
 *
 * @module domains/email/services/attachment-limits
 */

const DEFAULT_MAX_COUNT = 10;
const DEFAULT_MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MiB

export interface AttachmentLimits {
  maxCount: number;
  maxTotalBytes: number;
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function getAttachmentLimits(): AttachmentLimits {
  return {
    maxCount: parsePositiveInt(
      process.env.NEXTLY_EMAIL_MAX_ATTACHMENT_COUNT,
      DEFAULT_MAX_COUNT
    ),
    maxTotalBytes: parsePositiveInt(
      process.env.NEXTLY_EMAIL_MAX_ATTACHMENT_TOTAL_BYTES,
      DEFAULT_MAX_TOTAL_BYTES
    ),
  };
}
