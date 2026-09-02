import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HTML_DOCUMENT, PNG_1X1 } from "./__tests__/format-fixtures";
import { resolveClaimedMimeType } from "./mime";
import { validateAndSanitizeUpload } from "./validate-upload";

const loadFixture = (rel: string): Buffer =>
  readFileSync(join(__dirname, "__tests__/fixtures", rel));

const PNG = PNG_1X1;
const baseConfig = {
  allowedMimeTypes: undefined,
  additionalMimeTypes: undefined,
  maxSize: 10 * 1024 * 1024,
  maxSvgSize: 2 * 1024 * 1024,
};

describe("validateAndSanitizeUpload — pipeline ordering", () => {
  it("rejects bad filename first (FILENAME_INVALID)", async () => {
    const r = await validateAndSanitizeUpload(
      { buffer: PNG, filename: "../bad", mimeType: "image/png" },
      baseConfig
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0].code).toBe("FILENAME_INVALID");
      expect(r.errors[0].path).toBe("file");
    }
  });

  it("rejects blocked extension before MIME check (EXTENSION_BLOCKED)", async () => {
    const r = await validateAndSanitizeUpload(
      { buffer: PNG, filename: "evil.html", mimeType: "image/png" },
      baseConfig
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("EXTENSION_BLOCKED");
  });

  it("rejects hard-blocked MIME (MIME_BLOCKED)", async () => {
    const r = await validateAndSanitizeUpload(
      { buffer: PNG, filename: "x.png", mimeType: "text/html" },
      baseConfig
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("MIME_BLOCKED");
  });

  it("rejects MIME not in allowlist (MIME_NOT_ALLOWED)", async () => {
    const r = await validateAndSanitizeUpload(
      { buffer: PNG, filename: "x.zip", mimeType: "application/zip" },
      baseConfig
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("MIME_NOT_ALLOWED");
  });

  it("rejects oversize (SIZE_EXCEEDED)", async () => {
    const big = Buffer.alloc(baseConfig.maxSize + 1, 0);
    PNG.copy(big);
    const r = await validateAndSanitizeUpload(
      { buffer: big, filename: "x.png", mimeType: "image/png" },
      baseConfig
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("SIZE_EXCEEDED");
  });

  it("rejects oversize SVG against maxSvgSize (SIZE_EXCEEDED)", async () => {
    const svg = Buffer.alloc(baseConfig.maxSvgSize + 1, 0x20);
    Buffer.from(
      `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">`,
      "utf8"
    ).copy(svg);
    const r = await validateAndSanitizeUpload(
      { buffer: svg, filename: "x.svg", mimeType: "image/svg+xml" },
      baseConfig
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("SIZE_EXCEEDED");
  });

  it("rejects polyglot: image/svg+xml claim with PNG bytes (MAGIC_BYTE_MISMATCH)", async () => {
    const r = await validateAndSanitizeUpload(
      { buffer: PNG, filename: "x.svg", mimeType: "image/svg+xml" },
      baseConfig
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("MAGIC_BYTE_MISMATCH");
  });

  it("succeeds for a legitimate PNG", async () => {
    const r = await validateAndSanitizeUpload(
      { buffer: PNG, filename: "logo.png", mimeType: "image/png" },
      baseConfig
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.isSvg).toBe(false);
      expect(r.value.buffer).toBe(PNG); // not rewritten
    }
  });

  it("refuses HTML renamed to an accepted extension, whoever named the type", async () => {
    /*
     * Both spellings of one bypass, and they have to be asserted together: an
     * attacker writes the filename AND the reported type, so hardening either
     * route alone leaves the same upload one keystroke from succeeding.
     *
     * `.html` is a blocked extension and `text/html` a blocked type, but
     * neither string appears here — `payload.pdf` claiming `application/pdf`
     * passes both blocklists, and HTML carries no signature to contradict it.
     */
    for (const claimed of ["", "application/pdf"]) {
      const mimeType = resolveClaimedMimeType(
        "payload.pdf",
        claimed,
        HTML_DOCUMENT
      );
      // The type under test is the accepted one either way; the inferred route
      // reaching some other type would refuse for an unrelated reason.
      expect(mimeType).toBe("application/pdf");

      const r = await validateAndSanitizeUpload(
        { buffer: HTML_DOCUMENT, filename: "payload.pdf", mimeType },
        baseConfig
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0].code).toBe("MAGIC_BYTE_MISMATCH");
    }
  });

  it("succeeds for a legitimate SVG and replaces buffer with sanitized output", async () => {
    const dirty = loadFixture("svg/xss-script-tag.svg");
    const r = await validateAndSanitizeUpload(
      { buffer: dirty, filename: "x.svg", mimeType: "image/svg+xml" },
      baseConfig
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.isSvg).toBe(true);
      const out = r.value.buffer.toString("utf8");
      expect(out).not.toMatch(/<script/i);
      expect(out).toMatch(/<rect/);
      expect(r.value.buffer).not.toBe(dirty);
    }
  });

  it("logContext on failure carries operator detail", async () => {
    const r = await validateAndSanitizeUpload(
      { buffer: PNG, filename: "x.zip", mimeType: "application/zip" },
      baseConfig
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.logContext).toMatchObject({
        claimedMimeType: "application/zip",
      });
    }
  });
});
