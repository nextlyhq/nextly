/**
 * Upload Validation — Config Resolver
 *
 * @module services/upload-validation/resolve-config
 */

import { parseByteSize } from "../../utils/parse-byte-size";

import type { SecurityBlockLike, ValidationConfig } from "./types";

export const DEFAULT_MAX_SIZE = 10 * 1024 * 1024;
export const DEFAULT_MAX_SVG_SIZE = 2 * 1024 * 1024;

/**
 * Resolve the validator's effective config from a (possibly undefined)
 * security block. `maxSvgSize` is clamped to `min(maxSize, DEFAULT_MAX_SVG_SIZE)`
 * so a tighter per-file cap also tightens SVG.
 *
 * Falls back to defaults on malformed `fileSize` strings — `sanitizeConfig`
 * should catch these at boot, but defensive fall-back is safer than
 * throwing on every upload.
 */
export function resolveUploadValidationConfig(
  security: SecurityBlockLike | undefined
): ValidationConfig {
  const fileSizeRaw = security?.limits?.fileSize;
  let maxSize: number;
  if (fileSizeRaw === undefined) {
    maxSize = DEFAULT_MAX_SIZE;
  } else {
    try {
      maxSize = parseByteSize(fileSizeRaw);
    } catch {
      maxSize = DEFAULT_MAX_SIZE;
    }
  }

  return {
    allowedMimeTypes: security?.uploads?.allowedMimeTypes,
    additionalMimeTypes: security?.uploads?.additionalMimeTypes,
    maxSize,
    maxSvgSize: Math.min(maxSize, DEFAULT_MAX_SVG_SIZE),
  };
}
