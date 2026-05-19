/**
 * Upload Validation — DI Wrapper
 *
 * @module services/upload-validation/upload-validator
 */

import { resolveUploadValidationConfig } from "./resolve-config";
import type {
  SecurityBlockLike,
  ValidationConfig,
  ValidationResult,
} from "./types";
import { validateAndSanitizeUpload } from "./validate-upload";

/**
 * Holds a resolved `ValidationConfig` and exposes `validate()` for upload
 * pipelines. Stateless aside from the config snapshot; safe to register
 * as a singleton.
 *
 * @example
 * const validator = new UploadValidator(config.security);
 * const result = await validator.validate({ buffer, filename, mimeType });
 */
export class UploadValidator {
  private readonly _config: ValidationConfig;

  constructor(security: SecurityBlockLike | undefined) {
    this._config = resolveUploadValidationConfig(security);
  }

  validate(input: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
  }): Promise<ValidationResult> {
    return validateAndSanitizeUpload(input, this._config);
  }

  config(): Readonly<ValidationConfig> {
    return this._config;
  }
}
