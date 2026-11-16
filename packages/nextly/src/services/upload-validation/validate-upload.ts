/**
 * Upload Validation — Pipeline Entrypoint
 *
 * Runs every check in a fixed order, short-circuiting on first failure.
 * Lazy-imports heavy dependencies (`file-type`, `isomorphic-dompurify`)
 * inside the helpers they're used by so a path that never sees SVG never
 * pays the jsdom cost.
 *
 * Pipeline order (cheapest first); steps 1-4 are `validateUploadClaim`,
 * which a signed direct upload is judged by alone:
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
import { canonicalMimeType, resolveAllowlist, validateMimeType } from "./mime";
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
): Extract<ValidationResult, { ok: false }> {
  const error: UploadValidationError = {
    path: PATH_FILE,
    code,
    message: publicMessage,
  };
  return { ok: false, errors: [error], logContext };
}

/** What a claim check found: the claim in its canonical spelling, or why it was refused. */
export type ClaimResult =
  | { ok: true; mimeType: string; isSvg: boolean }
  | Extract<ValidationResult, { ok: false }>;

/**
 * Judge what an upload says about itself, before any of its bytes are read: its name, its
 * extension, its type against the allowlist, and its size against the caps.
 *
 * The first steps of every upload's checks, in the same order and with the same answers:
 * `validateAndSanitizeUpload` runs this, then the checks that need the bytes. A signed direct
 * upload, whose bytes go to storage without passing through here, is judged by this alone.
 */
export function validateUploadClaim(
  input: { filename: string; mimeType: string; size: number },
  config: ValidationConfig
): ClaimResult {
  const { filename, size } = input;
  /*
   * The claim in one spelling, before anything compares against it. Callers
   * reach this boundary by several routes — the mounted handler, the server
   * action, `UploadService` used directly — and a route that normalised its
   * own claim left the others meeting a canonicalised allowlist with a raw
   * one, refusing a format the install had allowed under its legacy name.
   *
   * It is also what gets STORED: the row then names the format the way the
   * allowlist and every later comparison do.
   */
  const mimeType = canonicalMimeType(input.mimeType);

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

  if (size > config.maxSize) {
    return fail("SIZE_EXCEEDED", "This file is too large.", {
      actualSize: size,
      maxSize: config.maxSize,
    });
  }
  const isSvg = isSvgMimeType(mimeType);
  if (isSvg && size > config.maxSvgSize) {
    return fail("SIZE_EXCEEDED", "This file is too large.", {
      actualSize: size,
      maxSize: config.maxSvgSize,
      reason: "svg-specific-cap",
    });
  }

  return { ok: true, mimeType, isSvg };
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
  const { buffer, filename } = input;
  const claim = validateUploadClaim(
    { filename, mimeType: input.mimeType, size: buffer.length },
    config
  );
  if (!claim.ok) return claim;
  const { mimeType, isSvg: claimedSvg } = claim;

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
