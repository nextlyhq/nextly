import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { detectAndCompareMime } from "./magic-bytes";

const fixtures = (rel: string): Buffer =>
  readFileSync(join(__dirname, "__tests__/fixtures", rel));

// Minimal real-format byte signatures (no fixture files needed here).
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const PDF = Buffer.from("%PDF-1.4\n", "utf8");

describe("detectAndCompareMime", () => {
  it("passes when claimed PNG matches PNG bytes", async () => {
    const r = await detectAndCompareMime(PNG, "image/png");
    expect(r.ok).toBe(true);
  });

  it("rejects claimed PNG with JPEG bytes", async () => {
    const r = await detectAndCompareMime(JPEG, "image/png");
    expect(r.ok).toBe(false);
  });

  it("passes when claimed image/svg+xml has real SVG bytes", async () => {
    const svg = fixtures("svg/legitimate-logo.svg");
    const r = await detectAndCompareMime(svg, "image/svg+xml");
    expect(r.ok).toBe(true);
  });

  it("rejects claimed image/svg+xml when buffer has no <svg> root (closes polyglot bypass)", async () => {
    const r = await detectAndCompareMime(PNG, "image/svg+xml");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("svg-claim-without-svg-content");
  });

  it("rejects when buffer is XML/SVG bytes but claim is image/png", async () => {
    const svg = fixtures("svg/legitimate-logo.svg");
    const r = await detectAndCompareMime(svg, "image/png");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("xml-content-non-svg-claim");
  });

  it("passes JPEG-vs-JPG fluff (claimed image/jpg with JPEG bytes)", async () => {
    const r = await detectAndCompareMime(JPEG, "image/jpg");
    expect(r.ok).toBe(true);
  });

  it("passes PDF when claimed application/pdf matches", async () => {
    const r = await detectAndCompareMime(PDF, "application/pdf");
    expect(r.ok).toBe(true);
  });

  it("passes when sniffer returns null (text formats like CSV)", async () => {
    const csv = Buffer.from("col1,col2\n1,2\n", "utf8");
    const r = await detectAndCompareMime(csv, "text/csv");
    expect(r.ok).toBe(true);
  });
});
