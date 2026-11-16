/**
 * What a signed direct upload is held to before it is signed.
 *
 * A direct upload's bytes go from the browser to storage and never pass
 * through Nextly, so the checks that read them (the content against its
 * declared type, the SVG sanitiser) cannot run. What the upload says about
 * itself can be judged, by the same checks and settings as every other upload
 * (`validateUploadClaim`), and the signature then binds what was judged: the
 * type and the exact size. Two things only a direct upload needs:
 *
 * - **No SVG.** An SVG can carry script, and only the sanitiser on the
 *   standard upload path removes it, so an SVG is never signed.
 * - **The extension names the type.** With no bytes to compare, the name is
 *   the only other witness: a claim the extension does not support, or an
 *   extension no accepted format has, is refused.
 *
 * @module storage/client-upload-claim
 */

import { NextlyError } from "../errors/nextly-error";
import { acceptedMimeFromFilename } from "../services/upload-validation/mime";
import { resolveUploadPolicy } from "../services/upload-validation/upload-policy";
import { validateUploadClaim } from "../services/upload-validation/validate-upload";

/** A direct upload's claim, as its signer receives it. */
export interface ClientUploadClaim {
  filename: string;
  mimeType: string;
  size: number;
}

function refuse(
  code: string,
  message: string,
  logContext: Record<string, unknown>
): never {
  throw NextlyError.validation({
    errors: [{ path: "file", code, message }],
    logContext,
  });
}

/**
 * Judge a direct upload's claim, or throw `VALIDATION_ERROR` naming why.
 * Returns the type to sign, in its canonical spelling.
 */
export function assertClientUploadClaim(claim: ClientUploadClaim): {
  mimeType: string;
} {
  if (!Number.isSafeInteger(claim.size) || claim.size <= 0) {
    refuse("SIZE_INVALID", "The file size is invalid.", { size: claim.size });
  }
  const judged = validateUploadClaim(
    claim,
    resolveUploadPolicy().validator.config()
  );
  if (!judged.ok) {
    throw NextlyError.validation({
      errors: judged.errors,
      logContext: { ...judged.logContext, path: "client-upload" },
    });
  }
  if (judged.isSvg) {
    refuse(
      "SVG_NOT_DIRECT",
      "SVG files go through the standard upload, where they are sanitised.",
      { filename: claim.filename }
    );
  }
  if (acceptedMimeFromFilename(claim.filename) !== judged.mimeType) {
    refuse(
      "EXTENSION_TYPE_MISMATCH",
      "The file's extension does not match its type.",
      { filename: claim.filename, claimedMimeType: judged.mimeType }
    );
  }
  return { mimeType: judged.mimeType };
}
