/**
 * Upload Validation — Pipeline Entrypoint
 *
 * Runs every check in a fixed order, short-circuiting on first failure.
 * Lazy-imports heavy dependencies (`file-type`, `isomorphic-dompurify`)
 * inside the helpers they're used by so a path that never sees SVG never
 * pays the jsdom cost.
 *
 * Pipeline order (cheapest first):
 *   1. validateFilename            — string check
 *   2. extension blocklist          — Set lookup
 *   3. validateMimeType             — Set lookup + wildcard match
 *   4. size cap                     — overall and SVG-specific
 *   5. detectAndCompareMime         — magic-byte sniff (lazy file-type)
 *   6. sanitizeSvg if SVG           — DOMPurify (lazy)
 *
 * `ValidatedFile.buffer` is always the bytes the caller should persist.
 * For SVGs it's the sanitized output — call sites can't accidentally
 * store unsanitized bytes.
 *
 * @module services/upload-validation/validate-upload
 */

import { isSvgMimeType } from "../../storage/svg-security";

import { isBlockedExtension } from "./extensions";
import { validateFilename } from "./filename";
import { detectAndCompareMime } from "./magic-bytes";
import { resolveAllowlist, validateMimeType } from "./mime";
import {
  SvgEmptyAfterSanitizeError,
  SvgTooLargeError,
  sanitizeSvg,
} from "./sanitize-svg";
import type {
  UploadValidationError,
  ValidationConfig,
  ValidationResult,
} from "./types";

const PATH_FILE = "file";

function fail(
  code: string,
  publicMessage: string,
  logContext: Record<string, unknown>
): ValidationResult {
  const error: UploadValidationError = {
    path: PATH_FILE,
    code,
    message: publicMessage,
  };
  return { ok: false, errors: [error], logContext };
}

/**
 * Validate (and sanitize where applicable) an uploaded file. Pure — returns
 * a result rather than throwing. Errors are in canonical
 * `NextlyError.validation` shape; callers wrap with the error class at
 * their own boundary.
 *
 * @example
 * const result = await validateAndSanitizeUpload(
 *   { buffer, filename, mimeType },
 *   resolveUploadValidationConfig(config.security),
 * );
 * if (!result.ok) {
 *   throw NextlyError.validation({ errors: result.errors, logContext: result.logContext });
 * }
 * await store(result.value.buffer);
 */
export async function validateAndSanitizeUpload(
  input: { buffer: Buffer; filename: string; mimeType: string },
  config: ValidationConfig
): Promise<ValidationResult> {
  const { buffer, filename, mimeType } = input;

  const fn = validateFilename(filename);
  if (!fn.ok) {
    return fail("FILENAME_INVALID", "Filename is invalid.", {
      reason: fn.reason,
      filename,
    });
  }

  if (isBlockedExtension(filename)) {
    return fail("EXTENSION_BLOCKED", "This file extension is not allowed.", {
      filename,
    });
  }

  const allowlist = resolveAllowlist(
    config.allowedMimeTypes,
    config.additionalMimeTypes
  );
  const mt = validateMimeType(mimeType, allowlist);
  if (!mt.ok) {
    if (mt.reason === "blocked") {
      return fail("MIME_BLOCKED", "This file type is not allowed.", {
        claimedMimeType: mimeType,
      });
    }
    return fail("MIME_NOT_ALLOWED", "This file type is not allowed.", {
      claimedMimeType: mimeType,
      allowlistSize: allowlist.length,
    });
  }

  if (buffer.length > config.maxSize) {
    return fail("SIZE_EXCEEDED", "This file is too large.", {
      actualSize: buffer.length,
      maxSize: config.maxSize,
    });
  }
  const claimedSvg = isSvgMimeType(mimeType);
  if (claimedSvg && buffer.length > config.maxSvgSize) {
    return fail("SIZE_EXCEEDED", "This file is too large.", {
      actualSize: buffer.length,
      maxSize: config.maxSvgSize,
      reason: "svg-specific-cap",
    });
  }

  const magic = await detectAndCompareMime(buffer, mimeType);
  if (!magic.ok) {
    return fail(
      "MAGIC_BYTE_MISMATCH",
      "File contents do not match the declared type.",
      {
        claimedMimeType: mimeType,
        sniffedMimeType: magic.sniffedMime,
        reason: magic.reason,
      }
    );
  }

  if (claimedSvg) {
    try {
      const clean = await sanitizeSvg(buffer);
      return {
        ok: true,
        value: { buffer: clean, filename, mimeType, isSvg: true },
      };
    } catch (err) {
      if (err instanceof SvgTooLargeError) {
        return fail("SIZE_EXCEEDED", "This file is too large.", {
          actualSize: err.actualSize,
          maxSize: err.maxSize,
          reason: "svg-too-large-after-sanitize",
        });
      }
      if (err instanceof SvgEmptyAfterSanitizeError) {
        return fail(
          "SVG_SANITIZATION_FAILED",
          "This SVG file could not be processed.",
          { reason: "empty-after-sanitize" }
        );
      }
      return fail(
        "SVG_SANITIZATION_FAILED",
        "This SVG file could not be processed.",
        {
          reason: "sanitizer-threw",
          cause: err instanceof Error ? err.message : String(err),
        }
      );
    }
  }

  return {
    ok: true,
    value: { buffer, filename, mimeType, isSvg: false },
  };
}
