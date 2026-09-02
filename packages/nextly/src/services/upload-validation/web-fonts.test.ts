/**
 * That the boundaries agree, rather than that each one lists what it lists.
 *
 * Three places need the same answer — what may be uploaded, what the public
 * route will serve, what the browser lets a person drag — and a test per list
 * asserting its own literals passes happily while they disagree. What matters
 * is the relation between them, so that is what these assert.
 *
 * @module services/upload-validation/web-fonts.test
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_ALLOWED_MIME_TYPES } from "./mime";
import {
  WEB_FONT_FORMATS,
  WEB_FONT_MIME_TYPES,
  webFontMimeFromFilename,
} from "./web-fonts";

describe("the canonical web font table", () => {
  it("is not empty, and every entry carries both vocabularies", () => {
    // The population, asserted before anything is derived from it: an empty
    // table satisfies every "each entry is..." loop below by never running one.
    expect(WEB_FONT_FORMATS.length).toBeGreaterThan(0);
    for (const format of WEB_FONT_FORMATS) {
      expect(format.mimeType).toMatch(/^font\//);
      expect(format.extension.startsWith(".")).toBe(true);
    }
  });

  it("offers only formats that need no conversion", () => {
    /*
     * The control on the table itself. Nothing here converts TTF or OTF, so
     * admitting one would store and serve several times the bytes of the same
     * face with nothing reporting it.
     */
    expect(WEB_FONT_MIME_TYPES).not.toContain("font/ttf");
    expect(WEB_FONT_MIME_TYPES).not.toContain("font/otf");
    expect(WEB_FONT_MIME_TYPES).not.toContain("application/font-sfnt");
  });
});

describe("the upload boundary", () => {
  it("accepts every format the table declares", () => {
    /*
     * The relation Codex's finding is about. A format the serving route hands
     * out but the allowlist refuses is one an author can never put there; the
     * reverse leaves an upload nothing will serve.
     */
    for (const mimeType of WEB_FONT_MIME_TYPES) {
      expect(DEFAULT_ALLOWED_MIME_TYPES).toContain(mimeType);
    }
  });

  it("does not accept a font format the table withholds", () => {
    // The control: an allowlist containing every font would satisfy the case
    // above while admitting the formats the table exists to exclude.
    expect(DEFAULT_ALLOWED_MIME_TYPES).not.toContain("font/ttf");
    expect(DEFAULT_ALLOWED_MIME_TYPES).not.toContain("font/otf");
  });
});

describe("inferring a font type from a filename", () => {
  it("names the canonical type for each format, whatever the case", () => {
    // Browsers report no type at all for a font chosen from disk, which is the
    // case this exists for — and the name they send keeps the author's casing.
    expect(webFontMimeFromFilename("Inter.woff2")).toBe("font/woff2");
    expect(webFontMimeFromFilename("Inter.WOFF2")).toBe("font/woff2");
    expect(webFontMimeFromFilename("Inter.woff")).toBe("font/woff");
  });

  it("names nothing for anything else", () => {
    /*
     * The control, and the security-relevant half: this fills in a claim the
     * caller did not make, so it must resolve for font names ONLY. Everything
     * else keeps whatever the caller sent, and the magic-byte check downstream
     * still compares that claim against the bytes.
     */
    expect(webFontMimeFromFilename("payload.ttf")).toBeUndefined();
    expect(webFontMimeFromFilename("archive.zip")).toBeUndefined();
    expect(webFontMimeFromFilename("woff2")).toBeUndefined();
    expect(webFontMimeFromFilename("")).toBeUndefined();
  });
});
