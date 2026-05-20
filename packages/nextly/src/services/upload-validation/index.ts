/**
 * Upload Validation — Public Surface
 *
 * @module services/upload-validation
 */

export { UploadValidator } from "./upload-validator";
export { validateAndSanitizeUpload } from "./validate-upload";
export {
  resolveUploadValidationConfig,
  DEFAULT_MAX_SIZE,
  DEFAULT_MAX_SVG_SIZE,
} from "./resolve-config";

export {
  BLOCKED_MIME_TYPES,
  DEFAULT_ALLOWED_MIME_TYPES,
  resolveAllowlist,
  validateMimeType,
} from "./mime";
export {
  BLOCKED_EXTENSIONS,
  getExtension,
  isBlockedExtension,
} from "./extensions";
export { validateFilename } from "./filename";
export { sanitizeSvg } from "./sanitize-svg";
export { detectAndCompareMime } from "./magic-bytes";

export type {
  UploadValidationError,
  ValidationConfig,
  ValidationResult,
  ValidationSuccess,
  ValidationFailure,
  ValidatedFile,
  SecurityBlockLike,
} from "./types";
