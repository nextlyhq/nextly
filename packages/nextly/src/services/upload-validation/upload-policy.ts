/**
 * Upload Validation — The Installation's Upload Policy, Resolved Once
 *
 * Every door that accepts a file has to enforce the same `security.uploads`
 * block: the mounted REST handler, the published server action, and anything
 * reaching `UploadService` directly. Each of them previously built that policy
 * for itself — read the config out of the container, construct a validator,
 * default `svgCsp` — which is one question with three answers that agree only
 * until one of them is edited.
 *
 * They ask this instead, so a change to where the config lives, or to either
 * default, moves every door at once.
 *
 * @module services/upload-validation/upload-policy
 */

import { container } from "../../di/container";

import type { SecurityBlockLike } from "./types";
import { UploadValidator } from "./upload-validator";

export interface UploadPolicy {
  /** Runs the allowlist, the size caps, the byte comparison and the sanitiser. */
  readonly validator: UploadValidator;
  /**
   * Whether a sanitized SVG is stored with `Content-Disposition: attachment`,
   * so direct navigation downloads it instead of rendering it in the origin.
   * Defaults on: an install that has not considered the question gets the
   * safe answer.
   */
  readonly svgCsp: boolean;
  /**
   * The per-file byte cap from `security.limits.fileSize`.
   *
   * Read off the validator's own resolved config rather than resolved a
   * second time: two derivations of one setting agree until one of them is
   * edited, and this one exists so the guards further down the write path can
   * agree with the check that actually refuses.
   */
  readonly maxSize: number;
}

/**
 * Build the upload policy from the installation's configuration.
 *
 * @returns The validator and the SVG disposition flag every upload path uses
 */
export function resolveUploadPolicy(): UploadPolicy {
  const security = container.has("config")
    ? container.get<{ security?: SecurityBlockLike }>("config")?.security
    : undefined;

  const validator = new UploadValidator(security);

  return {
    validator,
    svgCsp: security?.uploads?.svgCsp ?? true,
    maxSize: validator.config().maxSize,
  };
}
