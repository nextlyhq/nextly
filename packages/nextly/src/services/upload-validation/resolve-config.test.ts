import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_SIZE,
  DEFAULT_MAX_SVG_SIZE,
  resolveUploadValidationConfig,
} from "./resolve-config";

describe("resolveUploadValidationConfig", () => {
  it("returns defaults when security is undefined", () => {
    const c = resolveUploadValidationConfig(undefined);
    expect(c.maxSize).toBe(DEFAULT_MAX_SIZE);
    expect(c.maxSvgSize).toBe(DEFAULT_MAX_SVG_SIZE);
    expect(c.allowedMimeTypes).toBeUndefined();
    expect(c.additionalMimeTypes).toBeUndefined();
  });

  it("returns defaults when security has no uploads or limits", () => {
    const c = resolveUploadValidationConfig({});
    expect(c.maxSize).toBe(DEFAULT_MAX_SIZE);
    expect(c.maxSvgSize).toBe(DEFAULT_MAX_SVG_SIZE);
  });

  it("uses security.limits.fileSize when provided as a number", () => {
    const c = resolveUploadValidationConfig({ limits: { fileSize: 1024 } });
    expect(c.maxSize).toBe(1024);
  });

  it("parses string sizes (e.g. '5mb')", () => {
    const c = resolveUploadValidationConfig({ limits: { fileSize: "5mb" } });
    expect(c.maxSize).toBe(5 * 1024 * 1024);
  });

  it("falls back to default on malformed string", () => {
    const c = resolveUploadValidationConfig({
      limits: { fileSize: "not a size" },
    });
    expect(c.maxSize).toBe(DEFAULT_MAX_SIZE);
  });

  it("passes allowedMimeTypes through", () => {
    const c = resolveUploadValidationConfig({
      uploads: { allowedMimeTypes: ["image/png"] },
    });
    expect(c.allowedMimeTypes).toEqual(["image/png"]);
  });

  it("passes additionalMimeTypes through", () => {
    const c = resolveUploadValidationConfig({
      uploads: { additionalMimeTypes: ["application/zip"] },
    });
    expect(c.additionalMimeTypes).toEqual(["application/zip"]);
  });

  it("caps maxSvgSize at the smaller of maxSize and DEFAULT_MAX_SVG_SIZE", () => {
    const c = resolveUploadValidationConfig({ limits: { fileSize: 100_000 } });
    expect(c.maxSvgSize).toBeLessThanOrEqual(100_000);
  });
});
