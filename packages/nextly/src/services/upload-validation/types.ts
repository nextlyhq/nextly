/**
 * Upload Validation — Shared Types
 *
 * @module services/upload-validation/types
 */

import type { ValidationPublicData } from "../../errors/public-data";

/**
 * Single validation error entry. Identical to one element of
 * `ValidationPublicData.errors`, so the array can be passed straight to
 * `NextlyError.validation({ errors })` without remapping.
 */
export type UploadValidationError = ValidationPublicData["errors"][number];

export interface ValidationSuccess {
  ok: true;
  value: ValidatedFile;
}

export interface ValidationFailure {
  ok: false;
  errors: UploadValidationError[];
  /** Operator-only detail (sniffed type, sizes, reasons); never surfaced to clients per the §13.8 rubric. */
  logContext: Record<string, unknown>;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

export interface ValidatedFile {
  /** Bytes to persist. For SVGs, this is the sanitized output, never the input. */
  buffer: Buffer;
  filename: string;
  mimeType: string;
  /** Drives `Content-Disposition: attachment` on storage upload when `svgCsp` is enabled. */
  isSvg: boolean;
}

export interface ValidationConfig {
  /** Full override of the allowlist; when set, `additionalMimeTypes` is ignored. */
  allowedMimeTypes?: string[];
  /** Merged with `DEFAULT_ALLOWED_MIME_TYPES` when `allowedMimeTypes` is not provided. */
  additionalMimeTypes?: string[];
  /** Max overall file size in bytes (sourced from `security.limits.fileSize`). */
  maxSize: number;
  /** Stricter SVG cap; bounds XML-parser work to defang entity-expansion DoS. */
  maxSvgSize: number;
}

/**
 * Narrow shape of the `security` block the validator reads from. Decoupled
 * from the full `SanitizedNextlyConfig` so the validator stays insensitive
 * to unrelated config-schema changes. The validator itself only uses
 * `uploads.allowedMimeTypes`, `uploads.additionalMimeTypes`, and
 * `limits.fileSize`; `uploads.svgCsp` is included so callers that pass
 * the same block to services like `MediaService` don't need a second
 * type.
 */
export interface SecurityBlockLike {
  uploads?: {
    allowedMimeTypes?: string[];
    additionalMimeTypes?: string[];
    svgCsp?: boolean;
  };
  limits?: {
    fileSize?: string | number;
  };
}
