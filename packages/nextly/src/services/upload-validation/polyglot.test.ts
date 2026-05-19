import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { validateAndSanitizeUpload } from "./validate-upload";

const loadFixture = (rel: string): Buffer =>
  readFileSync(join(__dirname, "__tests__/fixtures/polyglot", rel));

const baseConfig = {
  allowedMimeTypes: undefined,
  additionalMimeTypes: undefined,
  maxSize: 10 * 1024 * 1024,
  maxSvgSize: 2 * 1024 * 1024,
};

describe("polyglot rejection — full pipeline", () => {
  it("rejects svg-claimed-as-png (xml content + non-SVG claim)", async () => {
    const buf = loadFixture("svg-claimed-as-png.bin");
    const r = await validateAndSanitizeUpload(
      { buffer: buf, filename: "x.png", mimeType: "image/png" },
      baseConfig
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0].code).toBe("MAGIC_BYTE_MISMATCH");
      expect(r.logContext.reason).toBe("xml-content-non-svg-claim");
    }
  });

  it("accepts png-trailing-svg at the magic-byte layer (sniffer sees PNG)", async () => {
    // The magic-byte check sees PNG and passes. Downstream defense
    // (sharp's image validation in the legacy media service) would
    // reject the malformed PNG. This fixture documents the boundary:
    // the validator is one layer, image-decoding adapters are another.
    const buf = loadFixture("png-trailing-svg.bin");
    const r = await validateAndSanitizeUpload(
      { buffer: buf, filename: "x.png", mimeType: "image/png" },
      baseConfig
    );
    expect(r.ok).toBe(true);
  });
});
