/**
 * That every upload door resolves ONE policy from the installation's config.
 *
 * The mounted handler, the server action and `UploadService` each used to
 * build this for themselves — read the config, construct a validator, default
 * `svgCsp`. Three answers to one question agree until one of them is edited,
 * and the edit that separates them looks local to whichever path it lands in.
 *
 * @module services/upload-validation/upload-policy.test
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { container } from "../../di/container";

import { PNG_1X1, WOFF2_HEADER } from "./__tests__/format-fixtures";
import { resolveUploadPolicy } from "./upload-policy";

beforeEach(() => container.clear());
afterEach(() => container.clear());

describe("resolveUploadPolicy", () => {
  it("enforces the allowlist the installation configured", async () => {
    container.registerSingleton("config", () => ({
      security: { uploads: { allowedMimeTypes: ["image/png"] } },
    }));

    const { validator } = resolveUploadPolicy();

    const refused = await validator.validate({
      buffer: WOFF2_HEADER,
      filename: "Inter.woff2",
      mimeType: "font/woff2",
    });
    expect(refused.ok).toBe(false);

    // The control: a policy that refuses everything would satisfy the line
    // above without reading the config at all.
    const accepted = await validator.validate({
      buffer: PNG_1X1,
      filename: "logo.png",
      mimeType: "image/png",
    });
    expect(accepted.ok).toBe(true);
  });

  it("defaults svgCsp on, and honours an install that turned it off", () => {
    /*
     * Asserted in both directions: a constant would satisfy either one alone,
     * and the default is the answer an install that never considered the
     * question gets.
     */
    expect(resolveUploadPolicy().svgCsp).toBe(true);

    container.clear();
    container.registerSingleton("config", () => ({
      security: { uploads: { svgCsp: false } },
    }));
    expect(resolveUploadPolicy().svgCsp).toBe(false);
  });

  it("carries the configured size cap, read off the validator it built", () => {
    /*
     * The number the guards further down the write path use. Resolving it a
     * second time from the same config would agree today and drift the moment
     * either derivation is edited, so it is read from the validator that will
     * actually do the refusing.
     */
    container.registerSingleton("config", () => ({
      security: { limits: { fileSize: "20mb" } },
    }));

    const policy = resolveUploadPolicy();
    expect(policy.maxSize).toBe(20 * 1024 * 1024);
    expect(policy.maxSize).toBe(policy.validator.config().maxSize);
  });

  it("answers with defaults when nothing is registered", () => {
    // Reached during scaffolding and in tests, where refusing to build a
    // policy would take down the upload path rather than secure it.
    const { svgCsp, validator } = resolveUploadPolicy();
    expect(svgCsp).toBe(true);
    expect(validator).toBeDefined();
  });
});
