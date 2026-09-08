import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HTML_DOCUMENT, JPEG_1X1, PNG_1X1 } from "./__tests__/format-fixtures";
import { detectAndCompareMime } from "./magic-bytes";

const fixtures = (rel: string): Buffer =>
  readFileSync(join(__dirname, "__tests__/fixtures", rel));

// Complete minimal files rather than lone signatures: a sniffer identifies
// these, so a test naming a matching type actually compares two types.
const PNG = PNG_1X1;
const JPEG = JPEG_1X1;
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

  it("rejects unidentifiable bytes claiming a format that HAS a signature", async () => {
    /*
     * HTML carries no magic, so it is identified as nothing — and a claim the
     * sniffer could have recognised, met with silence, is a claim these bytes
     * do not support. Reading that silence as agreement stored live markup
     * under a type that passes both blocklists.
     */
    const r = await detectAndCompareMime(HTML_DOCUMENT, "application/pdf");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature-absent");
  });

  it("rejects those bytes under the ALIAS of a format it knows", async () => {
    /*
     * `image/jpg` is the same format under a name the sniffer does not
     * publish, so a membership test on the raw claim reads it as a format
     * nothing can verify — waiving the rule for a spelling the caller picks.
     */
    const r = await detectAndCompareMime(HTML_DOCUMENT, "image/jpg");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature-absent");
  });

  it("still passes a signature-less format the sniffer can never identify", async () => {
    /*
     * The control for the two above, and the property that keeps the rule from
     * being "refuse whatever is unidentified": the same silence is the only
     * possible answer for JSON, so demanding evidence there would reject every
     * valid upload of it. What separates the cases is whether the format is
     * one the sniffer can read at all.
     */
    const json = Buffer.from('{"a":1}', "utf8");
    const r = await detectAndCompareMime(json, "application/json");
    expect(r.ok).toBe(true);
  });
});
