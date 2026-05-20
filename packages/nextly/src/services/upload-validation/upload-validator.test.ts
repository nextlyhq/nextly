import { describe, expect, it } from "vitest";

import { UploadValidator } from "./upload-validator";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("UploadValidator", () => {
  it("validates with resolved config from constructor", async () => {
    const v = new UploadValidator(undefined);
    const r = await v.validate({
      buffer: PNG,
      filename: "x.png",
      mimeType: "image/png",
    });
    expect(r.ok).toBe(true);
  });

  it("honors the provided security block (allowlist override)", async () => {
    const v = new UploadValidator({
      uploads: { allowedMimeTypes: ["image/png"] },
      limits: { fileSize: 1000 },
    });
    const r = await v.validate({
      buffer: PNG,
      filename: "x.zip",
      mimeType: "application/zip",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("MIME_NOT_ALLOWED");
  });

  it("config() exposes the resolved values", () => {
    const v = new UploadValidator({ limits: { fileSize: 5000 } });
    expect(v.config().maxSize).toBe(5000);
  });
});
